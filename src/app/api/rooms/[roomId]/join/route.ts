import { NextResponse } from "next/server";

import { joinRoom } from "@/lib/room-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const body = (await request.json()) as { playerName?: string };
  const room = await joinRoom(roomId, body.playerName ?? "");

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json(room);
}
