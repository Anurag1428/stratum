// POST localhost:3000/api/demo/background
import {generateText} from "ai"
import { google } from "@ai-sdk/google"
import { inngest } from "@/inngest/client"


export async function POST() {
    await inngest.send({ 
      name: "demo/generate",
      data: {},
    })

return Response.json({ status: "started" })
}