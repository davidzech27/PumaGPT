import { env } from "~/env.mjs"

export const config = {
	runtime: "edge",
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const getEmbedding = async (text: string) => {
	return (
		(await (
			await fetch("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.OPENAI_SECRET_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					input: text,
					model: "text-embedding-ada-002",
				}),
			})
		).json()) as { data: [{ embedding: number[] }] }
	).data[0].embedding
}

const searchPoints = async ({
	embedding,
	limit,
	filter,
}: {
	embedding: number[]
	limit: number
	filter?: Record<string, string | number>
}) => {
	return (
		(await (
			await fetch(`${env.QDRANT_URL}/collections/pumagpt/points/search`, {
				method: "POST",
				body: JSON.stringify({
					vector: embedding,
					limit,
					filter:
						filter !== undefined
							? {
									must: Object.keys(filter).map((key) => ({
										key,
										match: { value: filter[key] },
									})),
							  }
							: undefined,
					with_payload: true,
				}),
				headers: {
					"Content-Type": "application/json",
					"api-key": env.QDRANT_API_KEY,
				},
			})
		).json()) as {
			result: { id: number; score: number; payload: Record<string, string | number> }[]
		}
	).result
}

const handler = async function (request: Request) {
	if (request.method !== "POST") {
		return new Response("Method Not Allowed", { status: 405 })
	}

	const { messages } = (await request.json()) as { messages: string[] }

	if (
		!messages ||
		!(messages instanceof Array) ||
		messages.some((message) => typeof message !== "string") ||
		messages[0] === undefined
	) {
		return new Response("Bad request", { status: 400 })
	}

	const predictedAnswer = (
		(await (
			await fetch("https://api.openai.com/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.OPENAI_SECRET_KEY}`,
				},
				body: JSON.stringify({
					messages: [
						{ role: "system", content: "You are interesting and sensational." },
						{
							role: "user",
							content:
								messages.length === 1
									? `Respond with something that sounds like it could be found in an article from Maria Carrillo High's school newspaper "The Puma Prensa" that would answer the following question:

${messages[0]}`
									: `Respond with something that sounds like it could be found in an article from Maria Carrillo High's school newspaper "The Puma Prensa" that would answer the final question in the following:

${messages.join("\n\n")}`,
						},
					],
					model: "gpt-3.5-turbo",
					temperature: 0,
					max_tokens: 200,
				}),
			})
		).json()) as { choices: [{ message: { content: string } }] }
	).choices[0].message.content

	const embedding = await getEmbedding(predictedAnswer)

	const results = await searchPoints({ embedding, limit: 5 })

	const articlesUnfiltered = results.map((result) => ({
		title: result.payload.title as string,
		credits: result.payload.credits as string,
		dateString: result.payload.dateString as string,
		content: result.payload.content as string,
		wordCount: (result.payload.content as string)
			.split(/\s/)
			.filter((word) => word.trim() !== "").length,
	}))

	const articles: typeof articlesUnfiltered = []

	const wordLimit = messages.length === 1 ? 3000 : 2400

	let words = 0

	for (const article of articlesUnfiltered) {
		if (words + article.wordCount > wordLimit) break

		words += article.wordCount

		articles.push(article)
	}

	const articlesString = articles
		.map(
			(article) =>
				`${article.title}${
					article.dateString !== "" ? `\n\nFeatured on ${article.dateString}` : ""
				}\n\n${article.credits}\n\n${article.content}`
		)
		.join("\n\n")

	const response = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${env.OPENAI_SECRET_KEY}`,
		},
		body: JSON.stringify({
			messages:
				messages.length === 1
					? [
							{ role: "system", content: "You are helpful and accurate." },
							{
								role: "user",
								content: `Some relevant articles from Maria Carrillo High's school newspaper, "The Puma Prensa":

${articlesString}

Use these articles to respond to the following:

${messages[0]}

Cite specific articles. Phrase your responses very interestingly, including much detail, as though you are very knowledgable about Maria Carrillo High.`,
							},
					  ]
					: [
							{ role: "system", content: "You are helpful and accurate." },
							{
								role: "user",
								content: `Some relevant articles from Maria Carrillo High's school newspaper, "The Puma Prensa":

${articlesString}

Use these articles for the conversation that follows. Cite specific articles. Be transparent when you can't find information on a particular topic. Phrase your responses very interestingly, including much detail, as though you are very knowledgable about Maria Carrillo High. Here's the user's first message:

${messages[0]}`,
							},
							...messages.slice(1).map((message, index) => ({
								role: index % 2 === 0 ? "assistant" : "user",
								content: message,
							})),
					  ],
			model: "gpt-3.5-turbo",
			temperature: 0,
			stream: true,
		}),
	})

	return new Response(
		new ReadableStream({
			start: async (controller) => {
				if (response.body) {
					const reader = response.body.getReader()

					let streamedContent = ""

					let previousIncompleteChunk: Uint8Array | undefined = undefined

					while (true) {
						const result = await reader.read()

						if (!result.done) {
							let chunk = result.value

							if (previousIncompleteChunk !== undefined) {
								const newChunk = new Uint8Array(
									previousIncompleteChunk.length + chunk.length
								)

								newChunk.set(previousIncompleteChunk)

								newChunk.set(chunk, previousIncompleteChunk.length)

								chunk = newChunk

								previousIncompleteChunk = undefined
							}

							const parts = textDecoder
								.decode(chunk)
								.split("\n")
								.filter((line) => line !== "")
								.map((line) => line.replace(/^data: /, ""))

							for (const part of parts) {
								if (part !== "[DONE]") {
									try {
										// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
										const contentDelta = JSON.parse(part).choices[0].delta
											.content as string | undefined

										streamedContent += contentDelta ?? ""

										controller.enqueue(textEncoder.encode(contentDelta))
									} catch (error) {
										previousIncompleteChunk = chunk
									}
								} else {
									controller.close()

									console.log("Messages: ", messages)
									console.log("Response: ", streamedContent)
									console.log("Predicted response: ", predictedAnswer)
									console.log(
										"Unfiltered articles: ",
										articlesUnfiltered.map((article) => article.title)
									)
									console.log(
										"Articles: ",
										articles.map((article) => article.title)
									)

									return
								}
							}
						} else {
							console.error(
								"This also shouldn't happen, because controller should be close()ed before getting to end of stream"
							)
						}
					}
				} else {
					console.error("This shouldn't happen")
				}
			},
		}),
		{
			headers: { "Content-Type": "text/plain; charset=utf-8" },
		}
	)
}

export default handler
