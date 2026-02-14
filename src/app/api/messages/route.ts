import { convex } from "@/lib/convex-client";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { inngest } from "@/inngest/client";

const requestSchema = z.object({
    conversationId: z.string(),
    message: z.string(),
});

export async function POST(request: Request) {
    const { userId } = await auth();


    if (!userId) {
        return NextResponse.json({ error: "Unauthorized"}, { status: 401 })
    };

    const internalKey = process.env.STRATUM_CONVEX_INTERNAL_KEY;

    if (!internalKey) {
        return NextResponse.json(
            { error: "Internal key not configured" },
            { status: 500 }
        );
    }

    const body = await request.json();
    const { conversationId, message } = requestSchema.parse(body);

    // Call convex mutation, query
    const conversation = await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId: conversationId as Id<"conversations">,
    });

    if (!conversation) {
        return NextResponse.json(
            { error: "Conversation not found" },
            { status: 404 }
        );
    }

    const projectId = conversation.projectId;

    // Todo: Check for processing messages

    // Create a user message
    await convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId: conversationId as Id<"conversations">,
        projectId,
        role: "user",
        content: message,
    });

    // Create assistant message placeholder with processing status
    const assistantMessageId = await convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId: conversationId as Id<"conversations">,
        projectId,
        role: "assistant",
        content: "",
        status: "processing",
        }
    );

    // todo: Invoke inngest to process the message
    const event = await inngest.send({
        name: "message/sent",
        data: {
            messageId: assistantMessageId,
        },
    })

    return NextResponse.json({
        success: true,
        eventId: event.ids[0],
        messageId: assistantMessageId,
    });
};