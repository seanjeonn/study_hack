import { SessionResponseSchema } from "@/lib/schemas";
import { readSession } from "@/lib/server/session";

/** Who is signed in. The login page polls this while the browser tab is away. */
export async function GET() {
  const session = await readSession();
  return Response.json(
    SessionResponseSchema.parse(
      session ? { signedIn: true, email: session.email, name: session.name } : { signedIn: false },
    ),
  );
}
