import { NextResponse } from "next/server";

import { createRoom } from "@/lib/room-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      playerName?: string;
      difficulty?: string;
    };
    const room = await createRoom(body.playerName ?? "", body.difficulty);
    return NextResponse.json(room);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to create room",
      },
      { status: 500 },
    );
  }
}
