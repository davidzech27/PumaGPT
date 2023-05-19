import { useState, useEffect, useRef, useLayoutEffect, type FC, type ReactElement } from "react"
import { type NextPage } from "next"
import Head from "next/head"
import { Inter } from "next/font/google"
import { env } from "~/env.mjs"

const inter = Inter({
	subsets: ["latin"],
})

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const NoSSR: FC<{ children: ReactElement }> = ({ children }) => {
	const [isMounted, setIsMounted] = useState(false)

	;(typeof window === "undefined" ? useEffect : useLayoutEffect)(() => {
		setIsMounted(true)
	}, [])

	return isMounted ? children : null
}

const getBotMessage = async ({
	messages,
	onContent,
	onFinish,
}: {
	messages: string[]
	onContent: (content: string) => void
	onFinish: () => void
}) => {
	const response = await fetch("/api/bot", {
		method: "POST",
		body: textEncoder.encode(
			JSON.stringify({
				messages,
			})
		),
	})

	if (response.body) {
		const reader = response.body.getReader()

		while (true) {
			const result = await reader.read()

			if (!result.done) {
				onContent(textDecoder.decode(result.value))
			} else {
				onFinish()

				break
			}
		}
	} else {
		console.error("This shouldn't happen")
	}
}

const Home: NextPage = () => {
	const [messageInput, setMessageInput] = useState("")

	const [messages, setMessages] = useState<string[]>([])

	const [generating, setGenerating] = useState(false)

	const scrollerRef = useRef<HTMLDivElement>(null)

	const onSend = () => {
		if (generating) return

		const generatingIndex = messages.length + 1

		setMessages((messages) => [...messages, messageInput])

		process.nextTick(() => setMessageInput(""))

		setGenerating(true)

		scrollerRef.current?.scroll({ top: scrollerRef.current.scrollHeight })

		void getBotMessage({
			messages: messages.concat(messageInput),
			onContent: (content) => {
				setMessages((messages) => [
					...messages.slice(0, generatingIndex),
					(messages[generatingIndex] ?? "") + content,
				])

				scrollerRef.current?.scroll({
					top: scrollerRef.current.scrollHeight,
				})
			},
			onFinish: () => {
				setGenerating(false)
			},
		})
	}

	const sendDisabled = messageInput.trim() === "" || generating

	const messageInputRef = useRef<HTMLTextAreaElement>(null)

	const called = useRef(false)

	useEffect(() => {
		if (!called.current && messageInputRef.current !== null) {
			called.current = true

			messageInputRef.current.focus()
		}
	})

	return (
		<>
			<Head>
				<title>PumaGPT</title>
				<meta name="description" content="ChatGPT meets Maria Carrillo High" />
				<link rel="icon" href="/favicon.ico" />
			</Head>

			<main
				className={`fixed bottom-0 h-screen w-full bg-black text-white ${inter.className}`}
				style={{
					padding:
						"env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
				}}
			>
				<div className="flex h-screen flex-col px-[10%] pt-[0vh]">
					<NoSSR>
						<div
							className={`${
								typeof navigator !== "undefined" &&
								navigator.userAgent.includes("Safari") &&
								!navigator.userAgent.includes("Chrome") &&
								!navigator.userAgent.includes("EdgiOS") &&
								!navigator.userAgent.includes("DuckDuckGo") &&
								!navigator.userAgent.includes("FxiOS") &&
								navigator.userAgent.includes("iPhone")
									? "h-[25vh]"
									: "h-[7vh]"
							} flex items-center justify-center`}
						>
							<div
								className={`relative cursor-default text-center text-[8px] font-semibold md:text-xl ${
									typeof navigator !== "undefined" &&
									navigator.userAgent.includes("Safari") &&
									!navigator.userAgent.includes("Chrome") &&
									!navigator.userAgent.includes("EdgiOS") &&
									!navigator.userAgent.includes("DuckDuckGo") &&
									!navigator.userAgent.includes("FxiOS") &&
									navigator.userAgent.includes("iPhone")
										? "top-[6vh]"
										: "top-[0.25vh]"
								}`}
							>
								PumaGPT uses the{" "}
								<a
									href="https://thepumaprensa.org"
									className="underline underline-offset-1 transition-all duration-150 hover:opacity-80 active:opacity-80" // underline not working. perhaps solve this through other means if really necessary
									style={{
										background: "linear-gradient(to right, #97ff52, #f6fa00)",
										WebkitBackgroundClip: "text",
										backgroundClip: "text",
										color: "transparent",
									}}
								>
									Puma Prensa
								</a>{" "}
								to answer questions about Maria Carrillo High
							</div>
						</div>
					</NoSSR>

					<div className="relative flex h-full w-full flex-col overflow-y-scroll rounded-lg border-[0.5px] border-white/50 px-4 pt-2 text-lg">
						<div ref={scrollerRef} className="overflow-y-scroll text-white/[0.85]">
							{messages.map((message, index) => {
								return (
									<div
										key={index}
										className={`${
											index % 2 === 0 ? "font-medium opacity-[0.65]" : ""
										} mb-1 whitespace-pre-line`}
									>
										{message}
									</div>
								)
							})}

							<div className="h-[22vh]"></div>
						</div>

						<div className="absolute bottom-0 right-0 h-[15vh] min-h-[100px] w-full px-4 pb-4">
							<form
								onSubmit={(e) => {
									e.preventDefault()

									onSend()
								}}
								className="flex h-full w-full items-center justify-between rounded-lg border-[0.5px] border-white/50 bg-white/[0.06] backdrop-blur-lg transition-all duration-150 hover:border-white"
							>
								<textarea
									value={messageInput}
									onChange={(e) => setMessageInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.code === "Enter") {
											onSend()
										}
									}}
									placeholder={generating ? "Generating..." : "Ask something"}
									ref={messageInputRef}
									autoCapitalize="false"
									autoSave="true"
									autoFocus
									className="scrollbar-none h-full w-full resize-none bg-transparent px-3 py-1.5 outline-none placeholder:select-none placeholder:text-white placeholder:opacity-[0.4]"
								/>

								<button
									className={`group mx-5 my-4 flex h-[9.5vh] w-[9.5vh] items-center justify-center rounded-lg border-[0.5px] border-white/50 px-[1.5vh] transition-all duration-150 ${
										sendDisabled
											? "cursor-default bg-white/[0.06]"
											: "bg-white/[0.1] hover:border-white hover:bg-white/[0.15] active:bg-white/[0.15]"
									}`}
									disabled={sendDisabled}
								>
									<div
										className={`h-[6.5vh] w-[6.5vh] rounded-full border-4 border-white ${
											sendDisabled
												? "opacity-[0.65]"
												: "opacity-100 group-hover:opacity-100 group-active:opacity-100"
										}`}
									/>
								</button>
							</form>
						</div>
					</div>
					<footer>
						<div className="flex h-[7vh] items-center justify-center pb-[0.6vh]">
							<div className="text-center text-[8px] font-semibold md:text-lg">
								<span className="opacity-70">
									We&apos;re currently in an{" "}
									<span className="underline underline-offset-1">
										experimental phase
									</span>
									. Contact us{" "}
								</span>
								<a
									href={`mailto:${env.NEXT_PUBLIC_CONTACT_EMAIL}`}
									className="underline underline-offset-1 opacity-70 transition-all duration-150 hover:opacity-100 active:opacity-100"
								>
									here
								</a>{" "}
								<span className="opacity-70">if you encounter any issues.</span>
							</div>
						</div>
					</footer>
				</div>
			</main>
		</>
	)
}

export default Home
