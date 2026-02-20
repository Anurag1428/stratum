# STRATUM: Cloud IDE Technical Deep Dive

**Status: Pre-Alpha | Last Updated: February 2026 | Estimated Development: ~3-4 weeks**

---

## 1. CURRENT STATE & PROGRESS

### Implementation Completeness: ~35-40% of Core IDE

**What's Production-Ready:**
- ✅ **Authentication & Authorization**: Clerk integration with Convex auth middleware
- ✅ **Project Management**: CRUD operations, ownership isolation
- ✅ **File System Abstraction**: Hierarchical file/folder structure with full CRUD
- ✅ **Code Editor Foundation**: CodeMirror 6 integration with syntax highlighting, minimap, indentation markers
- ✅ **Conversation System**: Message storage, conversation management, real-time reactivity
- ✅ **Background Job Processing**: Inngest integration for async message handling
- ✅ **Observability**: Sentry error tracking at both server and client
- ✅ **UI Component Library**: 50+ Radix UI primitives + custom AI-facing components
- ✅ **Database Schema**: Convex backend with multi-table design and indexed queries

**What's Partially Implemented:**
- 🟡 **AI Integration**: Message pipeline scaffolded, actual LLM processing is stubbed (placeholder only)
- 🟡 **Code Suggestions**: Extension exists, API contract defined, backend not wired
- 🟡 **Quick Edit Feature**: Frontend UI complete, backend implementation missing
- 🟡 **Preview/Execution**: Not implemented (placeholder components only)
- 🟡 **File Export**: GitHub integration stubbed, not functional

**What's Missing Entirely:**
- ❌ **Code Execution Engine**: No runtime, container, or sandbox
- ❌ **Terminal/Shell Access**: No interactive terminal
- ❌ **npm/Package Management**: No dependency management
- ❌ **Git Integration**: Beyond UI tokens
- ❌ **Real-time Collaboration**: No CRDT or operational transform
- ❌ **Test Suite**: Zero unit/integration tests
- ❌ **E2E Tests**: Cypress/Playwright setup absent
- ❌ **Performance Optimizations**: No caching, no query batching, no pagination beyond basic limit
- ❌ **Mobile Support**: Responsive design incomplete

### What This Demonstrates About Your Engineering Ability

**Strong Foundations:**
- **Systems thinking**: You've designed a multi-layer architecture (frontend → API → Convex → background jobs) that cleanly separates concerns
- **Pragmatic tech choices**: Convex for real-time data (not a traditional REST API), Inngest for async, Clerk for auth — no overengineering
- **Type safety**: Full TypeScript with Zod validation and Convex-generated types
- **Cloud-native design**: You're thinking about scalability early (internal key validation, index strategy)
- **Security mindset**: Auth is enforced at the database layer, not just UI

**What Needs Depth:**
- The AI integration is stubbed out — you'll want to show how this scales (streaming responses, token management, context pruning)
- No performance metrics or load testing docs yet
- Incomplete error boundaries and graceful degradation paths
- Missing comprehensive testing strategy

---

## 2. HIGH-LEVEL OVERVIEW

### The Problem Stratum Solves

**User Problem**: Developers need a realistic IDE in the browser without:
- Installing software locally
- Managing dependencies
- Dealing with OS-specific issues
- Long setup time

**Stratum's Approach**: 
Build an AI-augmented cloud IDE that combines:
1. **File-based development** (familiar UX from VS Code, Replit, GitHub Codespaces)
2. **AI-powered assistance** (Copilot-like suggestions, quick edits, explanations)
3. **Lightweight backend** (Convex handles persistence, Inngest handles AI work)

### Where It Fits

```
┌─────────────────────────────────────────────────┐
│  Browser (Next.js Frontend)                     │
│  ├─ Code Editor (CodeMirror)                    │
│  ├─ File Explorer                               │
│  ├─ Conversation Sidebar                        │
│  └─ UI Components (Radix)                       │
└────────────────┬────────────────────────────────┘
                 │ (REST + Real-time)
┌────────────────▼────────────────────────────────┐
│  Edge Layer (Next.js API Routes)                │
│  ├─ /api/messages (message ingestion)           │
│  ├─ /api/inngest (event handler webhook)        │
│  ├─ Auth validation (Clerk)                     │
│  └─ Event dispatch                              │
└────────────────┬────────────────────────────────┘
         ┌───────┴────────┐
         │                │
┌────────▼──────┐  ┌──────▼──────────────┐
│ Convex        │  │ Inngest             │
│ (Realtime DB) │  │ (Async Jobs)        │
│               │  │                     │
│ ├─Projects    │  │ ├─process-message   │
│ ├─Files       │  │ ├─demoGenerate      │
│ ├─Messages    │  │ └─demoError         │
│ └─Conversats  │  │                     │
└───────────────┘  │ • Calls LLM API     │
                   │ • Scrapes web       │
                   │ • Updates Convex    │
                   └─────────────────────┘
```

### Why These Features Exist

| Feature | Why |
|---------|-----|
| **Projects** | Multi-workspace support; each project is isolated |
| **File Tree** | Familiar UX; allows nested structure; basis for imports |
| **Conversations** | Store context for each project; enable history/branching |
| **Code Suggestions** | Real-time assistance; reduces manual typing |
| **Quick Edit** | Inline AI refactoring without context switching |
| **Inngest** | Offload LLM latency; prevent request timeout (3 min limit on Vercel) |
| **Convex Storage** | Real-time sync; handles auth at DB layer; scales from 1 user to 10k |

---

## 3. SYSTEM DESIGN

### Core Components & Their Responsibilities

#### **Frontend Layer** (Next.js React 19 + TypeScript)

**Editor Module** (`src/features/editor/`)
- **Purpose**: Manage code editing experience
- **Key Classes/Functions**:
  - `CodeEditor.tsx`: Wraps CodeMirror with extensions (syntax highlight, minimap, suggestions, quick-edit)
  - `useEditorStore`: Zustand store for tab management (which files open, which is active)
  - `TopNavigation`: Tab bar showing open files
  - Extensions folder: Custom CodeMirror extensions (quick-edit, suggestion, selection-tooltip)
- **State**: Client-side only (tab state, scroll position); file content persists in Convex
- **Key Pattern**: Debounced file updates (1.5s delay before persisting to DB)

**File Explorer Module** (`src/features/projects/components/file-explorer/`)
- **Purpose**: Navigate and manipulate file tree
- **Responsibilities**:
  - Display hierarchical file structure
  - Create/delete/rename files and folders
  - Handle parent-child relationships
- **Data Flow**: 
  ```
  User clicks "New File" 
  → useCreateFile() mutation 
  → Convex inserts into "files" table 
  → Real-time subscription updates UI
  ```

**Conversation Module** (`src/features/conversations/`)
- **Purpose**: AI chat interface
- **Key Components**:
  - `ConversationSidebar`: Message input, history
  - Hooks: `useConversations`, `useMessages`, `useCreateConversation`
- **Data Flow**:
  ```
  1. User types message → clicks Send
  2. POST /api/messages with conversationId + text
  3. Creates user message in Convex
  4. Creates placeholder assistant message (status: "processing")
  5. Inngest event dispatched
  6. Background job processes & updates message
  7. Real-time subscription pushes update to UI
  ```

**Layout** (`src/features/projects/components/project-id-layout.tsx`)
- **Purpose**: Master layout for editor view
- **Pattern**: Allotment library (resizable splits)
- **Structure**: Conversation sidebar | Main editor area
- **Constraints**: Min/max widths to prevent UX collapse

#### **Backend Layer** (Convex)

**Database Schema** (`convex/schema.ts`)
```typescript
projects {
  _id, name, ownerId, updatedAt,
  importStatus, exportStatus, exportRepoUrl
}
files {
  _id, projectId, parentId, name, type, content, 
  storageId, updatedAt
  // Indexes: by_project, by_parent, by_project_parent
}
conversations {
  _id, projectId, title, updatedAt
  // Index: by_project
}
messages {
  _id, conversationId, projectId, role, content, status,
  // Indexes: by_conversation, by_project_status
}
```

**Query/Mutation Patterns** (`convex/*.ts`)
- **Auth Wrapper**: Every function calls `verifyAuth()` to get identity
- **Ownership Check**: Verify `ownerId === identity.subject` before returning data
- **Safe Queries**: Use indexed queries (e.g., `by_project`) to avoid full table scans
- **Atomic Operations**: Single mutation updates both record and parent's updatedAt

**Internal Key Pattern** (`convex/system.ts`)
- Background jobs run without user context (no Clerk token)
- Use `STRATUM_CONVEX_INTERNAL_KEY` to authenticate Inngest → Convex calls
- Only `processMessage`, `getConversationById`, `createMessage` accept internal key
- **Security**: Validates key on every call, non-retriable error if missing

#### **Event Processing Layer** (Inngest)

**Flow**:
```
1. POST /api/messages 
   → inngest.send({ name: "message/sent", data: { messageId } })

2. Inngest deduplicates + enqueues

3. Inngest triggers process-message function

4. Function workflow:
   a) Wait 5 seconds (placeholder for actual LLM call)
   b) Call convex.mutation(api.system.updateMessageContent, { ... })
   c) On failure: run onFailure handler, update message with error

5. Real-time subscription pushes to frontend
```

**Functions** (`src/features/conversations/inngest/process-message.ts`, `src/inngest/functions.ts`)
- `processMessage`: Handles user messages (stubbed LLM placeholder)
- `demoGenerate`: Example function showing URL extraction + web scraping + LLM call
- `demoError`: Testing error handling

**Key Features**:
- `cancelOn`: Can cancel in-flight processing if user requests
- `onFailure`: Graceful error handling
- Sentry middleware for error tracking

#### **API Layer** (Next.js Route Handlers)

**`/api/messages`** (`src/app/api/messages/route.ts`)
```typescript
POST /api/messages {
  conversationId: string,
  message: string
}
↓
1. Verify user is authenticated (Clerk auth())
2. Validate input (Zod schema)
3. Query Convex: get conversation (with internal key auth)
4. Create user message
5. Create assistant message with status="processing"
6. Dispatch Inngest event
7. Return { success, eventId, messageId }
```

**`/api/inngest`** (`src/app/api/inngest/route.ts`)
- Webhook endpoint for Inngest to register and call functions
- Serves: `demoGenerate`, `demoError`, `processMessage`

### Data Flow: Complete Message Journey

```
FRONTEND                          API                     CONVEX              INNGEST
─────────────────────────────────────────────────────────────────────────────────────

User types "fix this code"
  │
  └─[click send]────────────────────────────────────→ POST /api/messages
                                   │
                                  [Clerk auth check]
                                   │
                                  [Validate body]
                                   │
                                   └─ query system.getConversationById ──────→ returns conv
                                   │
                                   └─ mutate system.createMessage ──────────→ msg_user_1
                                   │
                                   └─ mutate system.createMessage ──────────→ msg_asst_1
                                   │                                         (status: "processing")
                                   │
                                   └─ inngest.send("message/sent") ─────────→ queued
                                   │
                                  [return 200 + eventId]
                                   │
    [display "Thinking..."]←───────┘
    [subscribe to messages]←─────────────────────────────────────────────────┐
                                                                              │
                                                          [Inngest detects event]
                                                          [triggers processMessage]
                                                                  │
                                                          [step.sleep 5s]
                                                                  │
                                                          [step.run: updateMessageContent]
                                                                  │
                                                  mutate system.updateMessageContent ─→
                                                                  │                   (update msg_asst_1)
                                                                  │
    [real-time update]←─────────────────────────────────────────┴───────────→
    [display response]
```

### State Management Strategy

**Real-time Sync via Convex**:
- Frontend uses `useQuery()` hooks (Convex React SDK)
- Queries are auto-subscribed and re-run when data changes
- No Redux, no manual sync — Convex handles it
- **Trade-off**: Automatic = less control, but simpler

**Client-side Only (Zustand)**:
- `useEditorStore`: Tab state (which files open, active tab)
- Why not Convex? Tab state is:
  - User preference, not shared
  - Heavy write volume (every keystroke could trigger a query)
  - Not critical if lost (reload = start fresh)

**Why This Split**:
- **Convex**: Persistent, shared, authorized data (files, messages, projects)
- **Zustand**: Ephemeral, local, session state (UI preferences)

### Boundaries Between Layers

#### Frontend ↔ API
- **Protocol**: HTTP POST with JSON body, Zod validation
- **Auth**: Clerk JWT in Authorization header (auto-injected by Next.js middleware)
- **Error Handling**: HTTP status codes + structured error messages
- **Latency**: Acceptable if <200ms (user input → message creation)

#### API ↔ Convex
- **Protocol**: Convex HTTP client
- **Auth**: Clerk JWT embedded in Convex context
- **Transactions**: Queries are read-only, mutations are atomic per-operation (not multi-operation transactions)
- **Latency**: <50ms typical (same datacenter)

#### API ↔ Inngest
- **Protocol**: Inngest SDK sends events, Inngest calls webhook
- **Auth**: Webhook signature verification (Inngest header)
- **Retry**: Inngest retries 3x if function fails
- **Latency**: Event enqueued immediately, processed within ~30s

#### Inngest ↔ Convex
- **Protocol**: Convex HTTP client (same as API)
- **Auth**: Internal key in env var (no user context)
- **Error Handling**: If mutation fails, onFailure handler runs; error logged to Sentry
- **Latency**: <100ms typical

### Why These Boundaries

**REST API Instead of Direct Convex**?
- ✅ API layer can aggregate, transform, validate before persisting
- ✅ Easier to add logging, rate limiting, metrics
- ✅ Can swap backend (Convex → Firebase → Supabase) by changing API
- ❌ Extra hop (frontend → API → Convex instead of frontend → Convex)

**Inngest Instead of Direct LLM API**?
- ✅ Survives request timeout (Vercel: 30s for Hobby, 5min for Pro; Inngest runs in background)
- ✅ Automatic retries + error handling
- ✅ Scales with number of concurrent messages
- ❌ Extra latency between message send and response (~5s sleep + processing)

**Why Convex Over Supabase/Firebase**?
- ✅ Real-time by default (no polling)
- ✅ Built-in auth integration (Clerk)
- ✅ Type-safe queries (generates TypeScript types from functions)
- ✅ No N+1 queries (queries run server-side)

---

## 4. ARCHITECTURAL DECISIONS

### Decision 1: Real-time Database (Convex) Over REST API

**Options Considered**:
1. **Convex** (chosen): Real-time, built-in auth, serverless functions
2. **REST + PostgreSQL + Socket.io**: Traditional; more familiar
3. **Firebase Realtime DB**: Real-time; weaker type safety; fewer integrations

**Why Convex**:
- Real-time subscriptions out of the box (no polling, no caching layers)
- Auth enforced at DB layer (can't query other users' projects without code change)
- Type safety from schema → TypeScript
- Scales to 100k concurrent clients on free tier
- Convex team is responsive (new auth features added within weeks of requests)

**Trade-offs Accepted**:
- Smaller ecosystem (3rd party libraries)
- Vendor lock-in (harder to migrate if Convex shuts down)
- Limited multi-document transactions (can't atomically update 3 tables in one mutation)

**Scaling Implications** (1K → 1M users):
- At 1K users: Current setup is fine; <100 queries/sec
- At 100K users: Might need query optimization (add more indexes, limit field projections)
- At 1M users: Convex can handle; cost scales with storage/compute; may need caching layer (Redis) for hot reads

---

### Decision 2: Inngest for Background Job Processing

**Options Considered**:
1. **Inngest** (chosen): SaaS event processing, built-in Sentry integration
2. **Bull Queue + Node.js server**: Self-hosted; full control
3. **AWS SQS + Lambda**: Serverless; good integration with AWS ecosystem
4. **Graphile Worker**: PostgreSQL-backed queue; lightweight

**Why Inngest**:
- Vercel's Next.js runs on demand = can't run background jobs natively
- Inngest is vendor-agnostic (works on any platform)
- Sentry middleware included (error tracking out of the box)
- Retry + resumption logic is complex; reinventing is error-prone
- Free tier gives 1M invocations/month

**Trade-offs Accepted**:
- Another 3rd party service (SaaS cost at scale)
- Latency between event send and job start (~5s observed)
- Can't guarantee FIFO (useful for message ordering)

**Scaling Implications**:
- At 100 users: Free tier sufficient (~3k events/day)
- At 10k users: Will exceed free tier (~300k events/day)
- At 100k users: ~$500-1000/month for Inngest
- Optimization: Batch message processing (process 10 messages in one job run)

---

### Decision 3: Clerk for Authentication

**Options Considered**:
1. **Clerk** (chosen): Managed auth platform; Convex integration exists
2. **Auth0**: More features; enterprise-grade; more expensive
3. **Supabase Auth**: Open source; self-hosted possible
4. **NextAuth.js**: Next.js-native; customizable

**Why Clerk**:
- Seamless Convex integration (can read JWT in Convex functions)
- Magic link + passkey + OAuth out of the box
- Dashboard for managing users (useful for debugging)
- Free tier: 5k monthly active users

**Trade-offs Accepted**:
- Can't self-host (vendor lock-in)
- UI is opinionated (can't fully white-label without enterprise plan)
- JWT verification needs Clerk's public key (adds HTTP call if not cached)

**Scaling Implications**:
- At 100k MAU: $25/month (Clerk pricing)
- At 1M MAU: $500-2k/month depending on plan
- No re-architecture needed; scales transparently

---

### Decision 4: CodeMirror 6 Over Monaco Editor

**Options Considered**:
1. **CodeMirror 6** (chosen): Lightweight; extensible; smaller bundle size
2. **Monaco**: VS Code editor; feature-rich; larger bundle
3. **Ace Editor**: Lightweight; older codebase
4. **Prism**: Not actually an editor (syntax highlighting only)

**Why CodeMirror 6**:
- Lightweight (~15KB gzipped core vs Monaco ~1.6MB)
- Extension system allows plugin-style code suggestions/quick-edit
- Replit uses it (precedent for cloud IDEs)
- Active maintenance + good documentation

**Trade-offs Accepted**:
- Fewer built-in features (no multi-cursor, limited refactoring)
- Smaller ecosystem of plugins
- Manual theming required

**Scaling Implications**:
- At 10k concurrent users: Bundle size matters (saves 1.5MB per session × 10k = 15GB aggregate)
- Client-side parsing (not server-side) = CPU cost is on user's machine

---

### Decision 5: Zustand Over Redux/Jotai

**Options Considered**:
1. **Zustand** (chosen): Minimal boilerplate; easy to use
2. **Redux**: Standard; predictable; verbose
3. **Jotai**: Atomic state; more functional
4. **Context API**: Built-in; sufficient for simple apps

**Why Zustand**:
- Minimal syntax (store created in 10 lines vs Redux 50 lines)
- No provider wrapping needed (can access store anywhere)
- Type-safe with TypeScript generics
- Perfect for client-only state (tab management)

**Trade-offs Accepted**:
- Less formal than Redux (easier to misuse)
- No time-travel debugging (Redux DevTools)
- Smaller community than Redux

**Scaling Implications**:
- At 100 files open: Store updates are synchronous (no latency)
- No issue with scale; state stays client-side

---

## 5. CODE WALKTHROUGH

### Module 1: Authentication & Authorization

**File**: `convex/auth.ts`
```typescript
export const verifyAuth = async (ctx: QueryCtx | MutationCtx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return identity;
}
```

**Intent**: Centralized auth check; every Convex function calls this first.

**Pattern**: Early return if unauthorized; trust the return value downstream.

**Why This Pattern**:
- DRY principle (don't repeat auth check in every function)
- Single source of truth for authorization logic
- Easy to add "require verified email" or "require specific role" here

---

### Module 2: File Management (CRUD)

**File**: `convex/files.ts`

**Key Functions**:

#### `getFolderContents`
```typescript
export const getFolderContents = query({
    args: { projectId, parentId: optional },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);
        const project = await ctx.db.get("projects", args.projectId);
        
        // Auth check
        if (project.ownerId !== identity.subject) 
            throw new Error("Unauthorized");

        // Query with index (fast)
        const files = await ctx.db
            .query("files")
            .withIndex("by_project_parent", (q) =>
                q.eq("projectId", args.projectId)
                 .eq("parentId", args.parentId)
            )
            .collect();

        // Sort: folders before files, alphabetically
        return files.sort((a, b) => {
            if (a.type === "folder" && b.type === "file") return -1;
            if (a.type === "file" && b.type === "folder") return 1;
            return a.name.localeCompare(b.name);
        });
    }
});
```

**Design Insights**:
- **Index Strategy**: Query uses composite index `["projectId", "parentId"]` (fast O(1) lookup)
- **Auth**: Check project ownership, not individual file (assumption: if user owns project, they own all files in it)
- **Sorting**: Done server-side (not client), reduces complexity on frontend
- **Tree Navigation**: `parentId` is `undefined` for root files; allows traversing up the tree

#### `createFile`
```typescript
export const createFile = mutation({
    args: { projectId, parentId: optional, name, Content },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);
        // ... auth checks ...

        // Prevent duplicates: check if file with same name exists in parent folder
        const existing = files.find(
            (file) => file.name === args.name && file.type === "file"
        );
        if (existing) throw new Error("File already exists");

        const now = Date.now();
        await ctx.db.insert("files", {
            projectId: args.projectId,
            name: args.name,
            content: args.Content,
            type: "file",
            parentId: args.parentId,
            updatedAt: now,
        });

        // Update parent project's updatedAt (important for sorting project list)
        await ctx.db.patch("projects", args.projectId, {
            updatedAt: now,
        });
    }
});
```

**Design Insights**:
- **Duplicate Prevention**: Done on write, not UI (prevents race conditions)
- **Timestamp Management**: Both file and project are updated (allows "Show me most recently modified projects")
- **Atomicity**: Both operations happen together (if second fails, first is rolled back by Convex)

#### `getFilePath` (Advanced Pattern)
```typescript
export const getFilePath = query({
    args: { id: v.id("files") },
    handler: async (ctx, args) => {
        // ... auth checks ...
        const path: { _id: string; name: string }[] = [];
        let currentId: Id<"files"> | undefined = args.id;

        while (currentId) {
            const file = await ctx.db.get("files", currentId);
            if (!file) break;
            path.unshift({ _id: file._id, name: file.name });
            currentId = file.parentId;
        }
        return path;
    }
});
```

**Design Insights**:
- **Tree Traversal**: Walks up the tree to get full path (file → parent → grandparent → root)
- **Breadcrumb Generation**: Path is returned as array, frontend renders as breadcrumb
- **Recursion via Loop**: Avoids stack overflow on deep trees

---

### Module 3: Conversation Management

**File**: `convex/conversations.ts`

#### `create`
```typescript
export const create = mutation({
    args: { projectId, title },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);
        const project = await ctx.db.get("projects", args.projectId);

        if (project.ownerId !== identity.subject) 
            throw new Error("Unauthorized");

        const conversationId = await ctx.db.insert("conversations", {
            projectId: args.projectId,
            title: args.title,
            updatedAt: Date.now(),
        });

        return conversationId;
    }
});
```

**Intent**: Create a new conversation within a project. Simple pattern.

#### `getMessages`
```typescript
export const getMessages = query({
    args: { conversationId },
    handler: async (ctx, args) => {
        const identity = await verifyAuth(ctx);
        const conversation = await ctx.db.get("conversations", args.conversationId);
        const project = await ctx.db.get("projects", conversation.projectId);

        if (project.ownerId !== identity.subject) 
            throw new Error("Unauthorized");

        return await ctx.db
            .query("messages")
            .withIndex("by_conversation", (q) => 
                q.eq("conversationId", args.conversationId)
            )
            .order("asc")  // Oldest first
            .collect();
    }
});
```

**Design Insight**:
- **Double-Check Auth**: Verify conversation → project → ownership (defense in depth)
- **Ordering**: Messages sorted by insertion order (ascending = oldest first)

---

### Module 4: Message Pipeline

**File**: `src/app/api/messages/route.ts`

```typescript
export async function POST(request: Request) {
    const { userId } = await auth();  // Clerk
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const internalKey = process.env.STRATUM_CONVEX_INTERNAL_KEY;
    const body = await request.json();
    const { conversationId, message } = requestSchema.parse(body);

    // 1. Fetch conversation (verify it exists and belongs to user)
    const conversation = await convex.query(api.system.getConversationById, {
        internalKey,
        conversationId: conversationId as Id<"conversations">,
    });

    // 2. Create user message
    await convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId,
        projectId: conversation.projectId,
        role: "user",
        content: message,
    });

    // 3. Create assistant message placeholder (processing status)
    const assistantMessageId = await convex.mutation(api.system.createMessage, {
        internalKey,
        conversationId,
        projectId: conversation.projectId,
        role: "assistant",
        content: "",
        status: "processing",
    });

    // 4. Trigger background job
    await inngest.send({
        name: "message/sent",
        data: { messageId: assistantMessageId },
    });

    return NextResponse.json({
        success: true,
        eventId: event.ids[0],
        messageId: assistantMessageId,
    });
}
```

**Data Flow Breakdown**:

| Step | Purpose | Why |
|------|---------|-----|
| Clerk auth | Verify user is logged in | No auth = no access |
| Zod parse | Validate types + structure | Prevent garbage data |
| Query getConversationById | Verify conversation exists | Can't message non-existent conversation |
| Mutation createMessage (user) | Persist user input | Save conversation history |
| Mutation createMessage (assistant) | Persist placeholder response | UI can show "Thinking..." status |
| inngest.send | Trigger async processing | Don't block request on LLM latency |

**Why Placeholder + Status**:
When AI processes slowly (~30s), frontend shouldn't wait. Instead:
1. Immediately show "Thinking..." spinner (placeholder message with status="processing")
2. Backend processes in background
3. When done, update message with actual content (status="completed")
4. Real-time subscription pushes update to frontend

---

### Module 5: Background Job Processing

**File**: `src/features/conversations/inngest/process-message.ts`

```typescript
export const processMessage = inngest.createFunction(
    {
        id: "process-message",
        cancelOn: [
            {
                event: "message/cancel",
                if: "event.data.messageId == async.data.messageId",
            },
        ],
        onFailure: async ({ event, step }) => {
            const messageId = event.data.event.data.messageId;
            await step.run("update-message-on-failure", async () => {
                await convex.mutation(api.system.updateMessageContent, {
                    internalKey: process.env.STRATUM_CONVEX_INTERNAL_KEY,
                    messageId,
                    content: "My apologies, I encountered an error...",
                });
            });
        }
    },
    { event: "message/sent" },
    async ({ event, step }) => {
        const { messageId } = event.data as MessageEvent;
        const internalKey = process.env.STRATUM_CONVEX_INTERNAL_KEY!;

        // Placeholder: wait 5 seconds
        await step.sleep("wait-for-ai-processing", "5s");

        // TODO: Replace with actual LLM call
        // const response = await step.run("call-llm", async () => {
        //   return await generateText({
        //     model: google("gemini-2.5-flash"),
        //     prompt: ...
        //   });
        // });

        // Update message with response
        await step.run("update-assistant-message", async () => {
            await convex.mutation(api.system.updateMessageContent, {
                internalKey,
                messageId,
                content: "AI processed this message (TODO)"
            });
        });
    }
);
```

**Key Patterns**:

1. **`step.run()`**: Every operation must be wrapped in a step. Why?
   - Step results are memoized (if function re-runs, same step won't execute twice)
   - Provides visibility in Inngest dashboard

2. **`cancelOn`**: Function can be cancelled by user
   ```typescript
   if (userClicksCancel)
       -> POST /api/messages/cancel { messageId }
       -> inngest.send({ name: "message/cancel", data: { messageId } })
       -> Inngest stops function
   ```

3. **`onFailure`**: If any step throws, this runs
   - Updates message with error text
   - Prevents "permanently stuck in Processing" state

---

### Module 6: Code Suggestions Extension

**File**: `src/features/editor/extensions/suggestion/index.ts`

```typescript
// 1. State management: Where does suggestion live?
const suggestionState = StateField.define<string | null>({
    create() { return null; },  // No suggestion initially
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setSuggestionEffect)) {
                return effect.value;  // New suggestion
            }
        }
        return value;  // Keep existing
    },
});

// 2. DOM widget: How to display suggestion?
class SuggestionWidget extends WidgetType {
    constructor(readonly text: string) { super(); }
    toDOM() {
        const span = document.createElement("span");
        span.textContent = this.text;
        span.style.opacity = "0.4";  // Ghost text
        return span;
    }
}

// 3. Fetcher logic: Build request payload
const generatePayload = (view: EditorView, fileName: string) => {
    const code = view.state.doc.toString();
    const cursorPosition = view.state.selection.main.head;
    const currentLine = view.state.doc.lineAt(cursorPosition);
    
    // Get surrounding context (5 lines before/after)
    const previousLines = [];
    for (let i = Math.max(1, currentLine.number - 5); i < currentLine.number; i++) {
        previousLines.push(view.state.doc.line(i).text);
    }
    
    return {
        fileName,
        code,
        currentLine: currentLine.text,
        previousLines: previousLines.join("\n"),
        textBeforeCursor: ...,
        textAfterCursor: ...,
        nextLines: ...,
        lineNumber: currentLine.number,
    };
};

// 4. Debounce plugin: Don't call API on every keystroke
const createDebouncePlugin = (fileName: string) => {
    return ViewPlugin.fromClass(
        class {
            triggerSuggestion(view: EditorView) {
                if (debounceTimer) clearTimeout(debounceTimer);
                
                debounceTimer = window.setTimeout(async () => {
                    const payload = generatePayload(view, fileName);
                    const suggestion = await fetcher(payload);
                    
                    view.dispatch({
                        effects: setSuggestionEffect.of(suggestion)
                    });
                }, 300);  // Wait 300ms after user stops typing
            }
        }
    );
};
```

**Design Pattern: State + Widget + Plugin**:
1. **State**: Redux-like; holds suggestion text
2. **Widget**: React-like; renders suggestion to DOM
3. **Plugin**: Observer; detects changes, fetches suggestion, updates state

**Performance Consideration**:
- Debounce 300ms: Don't spam API on every keystroke
- Abort previous request if user keeps typing (prevents outdated suggestions)

**Contract with Backend** (not yet implemented):
```typescript
POST /api/suggestion {
    fileName: "index.js",
    code: "const x = ",
    currentLine: "const x = ",
    textBeforeCursor: "const x = ",
    textAfterCursor: "",
    previousLines: "",
    nextLines: "...",
    lineNumber: 1,
}

Response: { suggestion: "42;" }
```

---

### Module 7: Real-time Data Subscription (Frontend)

**File**: `src/features/conversations/hooks/use-conversations.ts`

```typescript
export const useMessages = (conversationId: Id<"conversations"> | null) => {
    return useQuery(
        api.conversations.getMessages,
        conversationId ? { conversationId } : "skip"
    );
};
```

**How It Works**:
1. Component mounts with `conversationId = "conv_123"`
2. `useQuery(api.conversations.getMessages, { conversationId: "conv_123" })` 
3. Convex React client establishes WebSocket connection
4. Sends query to Convex backend
5. Backend runs query, returns results
6. Convex watches for changes to `messages` table (where conversationId = "conv_123")
7. If message inserted/updated/deleted:
   - Backend re-runs query
   - Pushes diff to client
   - Component re-renders
8. Component unmounts → WebSocket closed

**Why No Loading State**:
- First render: data is undefined (Convex hasn't responded yet)
- Component checks: `conversationMessages?.map()` handles undefined
- UI shows spinner until data arrives (handled by parent)

---

## 6. ENGINEERING PRINCIPLES APPLIED

### Performance

**Strengths**:
- **Real-time by Default**: No polling; changes arrive via WebSocket
- **Server-side Sorting**: File list sorted by Convex (not in loop on frontend)
- **Indexed Queries**: All queries use composite indexes (by_project, by_parent, by_conversation)
- **Lazy Loading**: Only fetch data on demand (specific file, specific conversation)

**Gaps**:
- **No Pagination**: `getFiles` collects all files; fails at 100k files in project
- **No Caching**: Every tab switch re-fetches file content (should cache in Zustand)
- **No Query Optimization**: File preview doesn't project fields (fetches content even if only need name)
- **No Debouncing on Mutations**: File updates debounced client-side (1.5s), but still sends mutation immediately

**How to Improve** (1M users):
```typescript
// Add pagination
export const getFiles = query({
    args: { projectId, limit: 50, offset: 0 },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("files")
            .withIndex("by_project", q => q.eq("projectId", args.projectId))
            .order("desc")
            .skip(args.offset)
            .take(args.limit);  // <= Add this
    }
});

// Cache file content in Zustand
const fileCache = new Map<string, Doc<"files">>();
export const useFile = (fileId) => {
    const cached = fileCache.get(fileId);
    const fresh = useQuery(api.files.getFile, ...);
    
    useEffect(() => {
        if (fresh) fileCache.set(fileId, fresh);
    }, [fresh]);
    
    return cached ?? fresh;
};
```

---

### Security

**Strengths**:
- **Auth at DB Layer**: Can't bypass auth by calling Convex directly (Clerk JWT required)
- **Ownership Isolation**: Projects filtered by `ownerId === identity.subject`
- **Internal Key Validation**: Background jobs can't call Convex without valid key
- **Input Validation**: Zod schemas on API layer + Convex's value types

**Gaps**:
- **No Rate Limiting**: User can spam `/api/messages` 1000x/sec
- **No Content Validation**: No SQL injection risk (Convex is typed), but no regex validation on file names
- **No CORS Protection**: File sharing not implemented (not a problem now, but will be for collaboration)
- **Hardcoded Internal Key**: Used in multiple places; if leaked, attacker can update any message

**Hardening Recommendations**:
```typescript
// 1. Rate limiting on API
import { Ratelimit } from "@upstash/ratelimit";

const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, "10s"),  // 10 requests per 10 seconds
});

export async function POST(request) {
    const { success } = await ratelimit.limit(userId);
    if (!success) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    // ...
}

// 2. Rotate internal key periodically (monthly)
// Publish new key to Vercel secret; old key stopped working

// 3. Validate filenames
if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    throw new Error("Invalid filename");
}
```

---

### Error Handling

**Strengths**:
- **App-level Errors**: Inngest's `onFailure` catches and logs
- **Observability**: Sentry middleware captures all errors with context
- **Graceful Degradation**: Message placeholder persists even if LLM fails
- **User Feedback**: Toasts show API errors (src/features/conversations/components/conversation-sidebar.tsx)

**Gaps**:
- **No Error Recovery**: If message update fails, user doesn't know (in background)
- **No Exponential Backoff**: Inngest retries 3x (default), no custom retry logic
- **No Circuit Breaker**: If LLM API is down, every message still tries; could overwhelm system

**Example: Better Error Handling**
```typescript
export const processMessage = inngest.createFunction(
    {
        id: "process-message",
        retries: 5,  // Default is 3
        backoffFn: async (attempt) => {
            // Exponential backoff: 2^attempt seconds
            const seconds = Math.pow(2, attempt);
            return { delay: `${seconds}s` };
        },
    },
    { event: "message/sent" },
    async ({ event, step, attempt }) => {
        // ...
        if (attempt > 3) {
            // Too many retries; probably permanent error
            await step.run("log-permanent-error", async () => {
                await sentry.captureMessage(
                    `Message processing failed after ${attempt} attempts`,
                    "error"
                );
            });
        }
    }
);
```

---

### Observability

**What's Implemented**:
- **Error Tracking**: Sentry hooks into Inngest, Next.js, browsers
- **Inngest Dashboard**: Visual queue, function logs, error traces
- **Convex Console**: Real-time query/mutation logs

**What's Missing**:
- **Metrics**: No latency tracking (file save → Convex → Inngest)
- **Logging**: Only errors logged; no info/debug logs
- **Traces**: No distributed tracing across services
- **Dashboards**: No Grafana/Datadog graphs

**Recommended Monitoring Stack** (for 1K users):
```
Frontend Errors → Sentry
Background Jobs → Inngest dashboard + Sentry
Database → Convex console
Custom Metrics → Datadog (or free: Prometheus + Grafana)
```

---

### Maintainability & Extensibility

**Good Practices**:
- **Modular Organization**: Features split into features/conversations, features/editor, etc.
- **Type Safety**: Full TypeScript; Convex generates types from schema
- **DRY**: `verifyAuth()` function reused; `generatePayload()` for suggestions extracted
- **Hooks Pattern**: All data fetching wrapped in custom hooks (easy to test)

**Needs Improvement**:
- **No Documentation**: No README explaining architecture (only auto-generated boilerplate)
- **TODO Comments**: `TODO: Add optimistic mutation`, `TODO: Implement LLM call` scattered
- **Inconsistent Naming**: `UpdateFile` (capital U) vs `createFile` (lowercase c)
- **Magic Numbers**: 300ms debounce, 5s sleep in processMessage (should be constants)

---

## 7. FAILURE SCENARIOS

### Scenario 1: User Sends Message While Offline

**What Happens**:
```
User in subway → loses connection
Clicks send (offline)
→ POST /api/messages fails (network error)
→ Toast: "Message failed to send"
→ Input cleared
→ User message never persists
```

**Why Problem**: 
- User might think message sent when it didn't
- No retry in frontend

**Solution**:
```typescript
const handleSubmit = async (message: PromptInputMessage) => {
    // Save optimistic copy to local state
    const optimisticId = nanoid();
    addLocalMessage(optimisticId, message.text, "pending");
    
    try {
        const response = await ky.post("/api/messages", { json: { ... } });
        updateLocalMessage(optimisticId, response.messageId, "sent");
    } catch (error) {
        updateLocalMessage(optimisticId, "failed");
        // Show retry button
    }
};
```

---

### Scenario 2: Message Processing Fails (LLM API Down)

**Current Behavior**:
1. POST /api/messages succeeds (message created)
2. Inngest fires; processMessage function runs
3. `await generateText(...)` throws 500 error
4. `onFailure` handler runs
5. Message updated: `content = "My apologies, I encountered an error..."`
6. Frontend shows error message

**Is This Good?**
- ✅ User knows something failed
- ✅ Conversation doesn't get stuck
- ❌ Generic error (no hint what went wrong)
- ❌ No way to retry

**Better**:
```typescript
onFailure: async ({ event, step, error }) => {
    const { messageId } = event.data;
    const errorType = 
        error.message.includes("RATE_LIMIT") ? "rate_limit" :
        error.message.includes("TIMEOUT") ? "timeout" :
        "unknown";
    
    await step.run("update-message-on-failure", async () => {
        await convex.mutation(api.system.updateMessageContent, {
            messageId,
            content: `Error: ${errorType}. [Retry]`,  // Retry button in UI
            errorType,  // Store for debugging
        });
    });
}
```

---

### Scenario 3: User Deletes File, Then Tries to Edit It

**Current Behavior**:
```
User opens file "app.js"
User deletes file
Tab still shows "app.js" (from Zustand)
User clicks tab
→ Editor tries to fetch file
→ useFile returns undefined
→ Placeholder image rendered
```

**Better**:
```typescript
const activeFile = useFile(activeTabId);
const { closeTab } = useEditor();

// Watch for deleted file
useEffect(() => {
    if (activeFile === null && activeTabId) {
        // File was deleted; close tab
        closeTab(activeTabId);
    }
}, [activeFile]);
```

---

### Scenario 4: Conversation Sidebar & Main Editor Desynchronize

**Could Happen**:
```
Two tabs open: Stratum app
Tab A: User clicks "New Conversation"
Tab B: User is viewing old conversation
→ Zustand state for active conversation is different
→ User edits in editor, but message goes to wrong conversation
```

**Current Safeguard**: Conversation ID passed explicitly in POST /api/messages (safe).

**Recommendation**: Still add warning if user is viewing stale conversation.

---

## 8. INTERVIEW-READY EXPLANATIONS

### The Setup Problem

**Interview**: "Tell me about your project."

**Your Answer** (60 seconds):
> Stratum is an AI-powered cloud IDE for the browser. Like Replit or GitHub Codespaces, but with AI-powered features like code suggestions and quick edits. 
>
> The architecture is React frontend → Next.js API → Convex (real-time database) + Inngest (background jobs). 
>
> User types message → API creates placeholder response → Inngest processes in background → Real-time sub updates UI. 
>
> Key decisions: Convex for real-time sync (not traditional REST), Inngest for background jobs (because Next.js doesn't have native workers), Clerk for auth.
>
> Currently ~35% complete: File system, conversations, and editor are working. Missing: actual LLM integration, execution engine, collaboration.

---

### Likely Follow-up: "Why Convex over PostgreSQL?"

**Better Answer**:
> Three reasons:
>
> 1. **Real-time by default**: Convex subscriptions are WebSocket-based; no polling or manual caching. Files update instantly across tabs.
>
> 2. **Auth at DB layer**: Can't query other users' projects without changing code. With REST + Postgres, you're trusting the API layer to enforce auth; if you add a new endpoint and forget to check ownership, user data leaks. Convex prevents this.
>
> 3. **Type safety**: Convex generates TypeScript types from schema. `api.files.getFile` return type is auto-inferred. With REST, you write types manually (error-prone).
>
> Trade-off: Smaller ecosystem, vendor lock-in. At scale (1M+ users), might need to add caching layer (Redis) to offload queries from Convex.

---

### Follow-up: "How do you handle the 30-second timeout on Vercel?"

**Answer**:
> Inngest. Next.js runs on Vercel's serverless functions, which timeout at 30 seconds (hobby plan) or 5 minutes (pro plan). 
>
> If we called the LLM directly in the API route, and the LLM took 20 seconds, we'd timeout. 
>
> Instead:
> 1. API route creates placeholder message, dispatches Inngest event, returns immediately
> 2. Inngest runs the long-running job in background (can take 5+ minutes)
> 3. When done, updates message via Convex mutation
> 4. Real-time subscription pushes update to UI
>
> This is the pattern for any long operation: create placeholder, offload to queue, poll/subscribe for completion.

---

### Follow-up: "What happens if the user closes the browser tab while processing?"

**Answer**:
> Good question. Three cases:
>
> 1. **Message sent, but processing not started yet**: Inngest still runs in background. User refreshes browser → subscription re-established → sees completed message. No data loss.
>
> 2. **Processing started**: Inngest continues. User can cancel via `/api/messages/cancel`. Message status remains "processing" until Inngest completes or times out.
>
> 3. **Inngest update fails**: `onFailure` handler runs; message updated with error. User sees error next time they open the tab.
>
> The key: **Inngest doesn't rely on the user's browser**. It's server-driven, not client-driven.

---

### Follow-up: "How do you prevent N+1 queries?"

**Answer**:
> Convex runs queries server-side, so N+1 prevention is built-in. When you call `getMessages`, Convex:
> 1. Queries messages table (1 query)
> 2. Returns all results in one batch
>
> You can't accidentally do:
> ```typescript
> messages.forEach(msg => {
>     const author = await fetchAuthor(msg.authorId);  // N queries!
> });
> ```
>
> Because you can't call async functions in your component render. All data fetching is in Convex functions.
>
> However, if we need to join messages with user info, we'd have to fetch in Convex and return denormalized data. That's where you might add a view or cache.

---

### Follow-up: "How do you scale this to 100k users?"

**Optimizations Needed**:
1. **Pagination**: Don't load all 1M files; load 50 at a time
2. **Caching**: Redis for hot reads (popular files, frequent queries)
3. **Query optimization**: Add more composite indexes (by_owner_updatedAt)
4. **Batch processing**: Inngest batches 100 messages per job run
5. **CDN for assets**: CodeMirror JS on CDN
6. **Database sharding**: Convex handles internally; might need to partition by project ID manually

**What Doesn't Scale**:
- Message processing serializes (one LLM call per message); parallelize with job pools
- No distributed lock on file edits; multiple users editing same file causes conflicts
- Conversation history grows unbounded; archive old messages after 30 days

---

## 9. FUTURE EVOLUTION

### Phase 2 (Weeks 5-8): LLM Integration & AI Features

```typescript
// Replace stub with real LLM call
const processMessage = inngest.createFunction(
    { id: "process-message" },
    { event: "message/sent" },
    async ({ event, step }) => {
        const { messageId } = event.data;
        
        // Fetch message + conversation history
        const message = await step.run("fetch-message", async () => {
            return await convex.query(api.system.getMessageById, {
                messageId, internalKey
            });
        });
        
        const history = await step.run("fetch-history", async () => {
            return await convex.query(api.system.getConversationMessages, {
                conversationId: message.conversationId,
                limit: 10,  // Last 10 messages
                internalKey,
            });
        });
        
        // Extract context from project (files, schema)
        const context = await step.run("extract-context", async () => {
            return await convex.query(api.system.getProjectContext, {
                projectId: message.projectId,
                internalKey,
            });
        });
        
        // Call LLM with streaming
        const response = await step.run("call-llm", async () => {
            const fullPrompt = buildPrompt(context, history, message.content);
            return await generateText({
                model: google("gemini-2.5-flash"),
                prompt: fullPrompt,
                system: SYSTEM_PROMPT,
            });
        });
        
        // Update message
        await step.run("update-message", async () => {
            await convex.mutation(api.system.updateMessageContent, {
                messageId,
                content: response.text,
                internalKey,
            });
        });
    }
);
```

---

### Phase 3 (Weeks 9-12): Execution Engine

```typescript
// New API: /api/execute
export async function POST(request) {
    const { projectId, fileId } = await request.json();
    
    // Spin up isolated container
    const container = await docker.run("node:latest", {
        volumes: { "/app": `/tmp/project-${projectId}` },
    });
    
    // Copy user's files into container
    await syncFiles(projectId, `/tmp/project-${projectId}`);
    
    // Run the file
    const { stdout, stderr } = await container.exec("node", fileId);
    
    // Stream output to user
    return Response.stream(stdout, stderr);
}
```

**This Opens Up**:
- Console output display
- Real-time execution results
- Test running
- Package management

---

### Code Quality Improvements

**Tests** (Weeks 3-4, parallel with development):
```typescript
// convex/files.test.ts
describe("files.ts", () => {
    it("prevents duplicate files in parent", async () => {
        const projectId = await createTestProject();
        await createFile({ projectId, name: "app.js" });
        
        // Should throw
        expect(() => 
            createFile({ projectId, name: "app.js" })
        ).toThrow("File already exists");
    });

    it("enforces ownership", async () => {
        const projectId = await createTestProject({ ownerId: "user1" });
        
        // user2 tries to access
        expect(() => 
            getFile({ fileId: "...", ownerId: "user2" })
        ).toThrow("Unauthorized");
    });
});
```

**Refactoring Ideas**:
```typescript
// Extract auth checks into middleware
const withAuth = (handler) => async (ctx, args) => {
    const identity = await verifyAuth(ctx);
    return handler(ctx, args, identity);
};

export const getFiles = query({
    handler: withAuth(async (ctx, args, identity) => {
        // ... handler code
    })
});

// Extract constants
const DEBOUNCE_DELAY_MS = 300;
const SUGGESTION_CONTEXT_LINES = 5;
const FILE_UPDATE_DEBOUNCE = 1500;
```

---

### Refactoring: Backend

**Problem**: `updateMessageContent` requires explicit `content` parameter (no semantic update).

**Solution**: 
```typescript
// Instead of
await convex.mutation(api.system.updateMessageContent, {
    messageId,
    content: "new content",
});

// Use semantic mutations
await convex.mutation(api.messages.complete, {
    messageId,
    content: "new content",
});

await convex.mutation(api.messages.fail, {
    messageId,
    error: "RATE_LIMIT",
});
```

**This Self-Documents** the intent (not just "update content").

---

### What Was Intentionally Kept Simple (& Why)

| Feature | Current | Why Simple | When to Upgrade |
|---------|---------|-----------|-----------------|
| **Auth** | Clerk JWT | Familiar UX, works; not custom | Never (unless you need fine-grained roles) |
| **DB Transactions** | Single mutations | Convex doesn't support multi-doc transactions; acceptable for current schema | If you need "atomically delete files + mark project as deleted" |
| **Real-time Sync** | Convex subscriptions | Automatic; no manual syncing | If you need offline-first (add CRDT like Yjs) |
| **Error Handling** | Generic messages | Works for MVP; users accept generic errors | At 1k users, add detailed error messages + retry UI |
| **Caching** | None | Convex is fast enough; premature optimization | At 100k users, add Redis for hot files |
| **File Conflict Resolution** | Last-write-wins | Fine for solo users; doesn't handle simultaneous edits | If adding collaboration, implement Operational Transform |

---

### What You Should Refactor Later

**High Priority**:
1. **Stub out missing functions**: `getProjectContext`, `getConversationMessages` (now just placeholders)
2. **Error handling**: Add retry buttons, specific error messages
3. **Performance**: Add pagination, caching
4. **Tests**: 50% code coverage minimum

**Medium Priority**:
1. **Naming**: Standardize `createFile` vs `CreateFile`
2. **Organization**: Move API route logic into service layer
3. **Documentation**: Add architecture decision records (ADRs)
4. **Monitoring**: Export metrics to Datadog

**Low Priority** (defer to when needed):
1. Collaboration (CRDT)
2. Package management
3. Custom themes
4. Mobile optimization

---

## CONCLUSION: Positioning for Interviews

### What This Project Shows
- ✅ **Full-stack thinking**: You understand data flow from frontend all the way through background jobs
- ✅ **Pragmatic architecture**: You chose tools (Convex, Inngest, Clerk) based on trade-offs, not hype
- ✅ **Type safety discipline**: Full TypeScript, Zod validation, generated types
- ✅ **Security mindset**: Auth at DB layer, internal key validation, ownership checks
- ✅ **Real-time systems**: You understand WebSocket subscriptions, eventual consistency
- ✅ **Scalability thinking**: You identified bottlenecks (pagination, caching) before they matter

### What Weaknesses to Address Before Interviews
- 🔴 **Incomplete AI integration**: Be honest ("LLM call is stubbed for now; here's how I'd implement it")
- 🔴 **No tests**: Add 10-20 unit tests to show testing discipline
- 🔴 **No error handling**: Add retry buttons, graceful degradation
- 🔴 **No monitoring**: Show you think about observability (Sentry, custom metrics)

### Interview Script
> "Stratum is a cloud IDE with AI features. I designed it as React → Next.js API → Convex + Inngest. 
>
> Key architectural decision: Use Inngest for background jobs because Next.js serverless functions timeout at 30s. Message sent → Placeholder created → Job processes in background → Real-time update.
>
> Why Convex? Real-time subscriptions by default, auth at DB layer, type-safe queries.
>
> What's incomplete: LLM integration (stubbed with placeholder), execution engine (no runtime), collaboration (would need CRDT). Current state: ~35% of a full IDE.
>
> If you asked me to scale to 100k users, I'd add pagination, Redis caching, query optimization."

---

**End of Technical Analysis**

*Prepared for: Senior Engineer self-assessment + Interview preparation*

*Total Implementation Time: ~3-4 weeks (estimated)*

*Current Completion: 35-40% (front-end complete, back-end scaffolding complete, AI stub only)*
