import * as cheerio from "cheerio"

const { QDRANT_URL, QDRANT_API_KEY, OPENAI_SECRET_KEY } = process.env

if (typeof QDRANT_URL !== "string") {
	console.error("Must set QDRANT_URL environment variable")

	process.exit(1)
}

if (typeof QDRANT_API_KEY !== "string") {
	console.error("Must set QDRANT_API_KEY environment variable")

	process.exit(1)
}

if (typeof OPENAI_SECRET_KEY !== "string") {
	console.error("Must set OPENAI_SECRET_KEY environment variable")

	process.exit(1)
}

const createCollection = async () => {
	await fetch(`${QDRANT_URL}/collections/pumagpt`, {
		method: "PUT",
		body: JSON.stringify({
			name: "pumagpt",
			vectors: {
				size: 1536,
				distance: "Dot",
			},
		}),
		headers: {
			"Content-Type": "application/json",
			"api-key": QDRANT_API_KEY,
		},
	})
}

const insertPoints = async (
	points: { id: number; payload: Record<string, string | number>; vector: number[] }[]
) => {
	await (
		await fetch(`${QDRANT_URL}/collections/pumagpt/points`, {
			method: "PUT",
			body: JSON.stringify({ points }),
			headers: {
				"Content-Type": "application/json",
				"api-key": QDRANT_API_KEY,
			},
		})
	).json()
}

const countPoints = async () => {
	return (
		(await (
			await fetch(`${QDRANT_URL}/collections/pumagpt/points/count`, {
				method: "POST",
				body: JSON.stringify({
					exact: true,
				}),
				headers: {
					"Content-Type": "application/json",
					"api-key": QDRANT_API_KEY,
				},
			})
		).json()) as { result: { count: number } }
	).result.count
}

const getEmbedding = async (text: string) => {
	return (
		(await (
			await fetch("https://api.openai.com/v1/embeddings", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${OPENAI_SECRET_KEY}`,
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

const getHTML = async (url: string) => {
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	const response = (await fetch(url)).body!.getReader()

	let html = ""

	while (true) {
		const chunk = await response.read()
		if (chunk.done) break
		html += Buffer.from(chunk.value).toString("utf8")
	}

	return html
}

const main = async () => {
	await createCollection()

	const startingURL = "https://www.thepumaprensa.org"

	const articles: { url: string; dateString: string }[] = []

	const visitedURLs = new Set([startingURL])

	const visitAllLinks = async ($: cheerio.CheerioAPI) => {
		for (const element of $("a")) {
			const anchor = $(element)

			let href = anchor.attr("href")

			if (!href) continue

			if (href[0] === "/") href = startingURL + href

			if (visitedURLs.has(href) || !href.includes("thepumaprensa.org")) continue

			if (
				href.includes("blog") &&
				!href.split("/").at(-2)?.includes("thepumaprensa.org") &&
				href.split("/").at(-1)?.includes("-")
			) {
				const time = anchor.parentsUntil("article").last().parent().find("time").first()

				articles.push({
					url: href,
					dateString: time.text().trim() || articles.at(-1)?.dateString || "", // super messy
				})
			}

			visitedURLs.add(href)

			const $href = cheerio.load(await getHTML(href))

			console.info("Visited ", href)

			await visitAllLinks($href)
		}
	}

	const startingHTML = await getHTML(startingURL)

	await visitAllLinks(cheerio.load(startingHTML))

	console.info(
		"Article URLs: ",
		articles.map((article) => article.url)
	)

	console.info("Article count: ", articles.length)

	let articleIndex = 0

	for (const { url, dateString } of articles) {
		const $ = cheerio.load(await getHTML(url))

		const title = $('h1[data-content-field="title"]').first().text()

		const credits = $("strong").first().text()

		const content = $(".sqs-block-content > p")
			.map((_index, element) => $(element).text().trim())
			.toArray()
			.filter(
				(paragraph) =>
					paragraph !== "" &&
					!paragraph.includes("Photo: ") &&
					paragraph !== credits &&
					paragraph !== "Made with Squarespace"
			)
			.join("\n\n")

		const article = { title, credits, dateString, content }

		const embedding = await getEmbedding(`${title}\n\n${credits}\n\n${content}`)

		await insertPoints([{ id: articleIndex, vector: embedding, payload: article }])

		console.info("Uploaded ", title)

		articleIndex++
	}

	console.info("Uploaded ", articleIndex, " articles")

	console.info(await countPoints(), " points in database")
}

void main()
