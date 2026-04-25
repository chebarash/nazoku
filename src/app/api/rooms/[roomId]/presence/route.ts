import { NextResponse } from "next/server";

import { refreshPresence } from "@/lib/room-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  const { roomId } = await context.params;
  const body = (await request.json()) as {
    playerId?: string;
    playerName?: string;
    playerColor?: string;
  };

  const ok = await refreshPresence(roomId, {
    playerId: body.playerId ?? "",
    playerName: body.playerName ?? "",
    playerColor: body.playerColor ?? "",
  });

  if (!ok) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
