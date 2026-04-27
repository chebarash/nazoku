import { NextResponse } from "next/server";

import {
  createRoom,
  getRoomState,
  joinRoom,
  postRoomAction,
  refreshPresence,
} from "@/lib/room-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const preferredRegion = ["iad1"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get("roomId");

  if (!roomId) {
    return NextResponse.json({ error: "roomId is required" }, { status: 400 });
  }

  const room = await getRoomState(roomId);

  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  return NextResponse.json({ room });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "create-room") {
      const room = await createRoom(body.playerName ?? "", body.difficulty);
      return NextResponse.json(room);
    }

    if (body.action === "join-room") {
      const room = await joinRoom(body.roomId ?? "", body.playerName ?? "");

      if (!room) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }

      return NextResponse.json(room);
    }

    if (body.action === "presence") {
      const ok = await refreshPresence(body.roomId ?? "", {
        playerId: body.playerId ?? "",
        playerName: body.playerName ?? "",
        playerColor: body.playerColor ?? "",
      });

      if (!ok) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }

      return NextResponse.json({ ok: true });
    }

    if (body.action === "room-event") {
      const room = await postRoomAction(body.roomId ?? "", body.payload);

      if (!room) {
        return NextResponse.json({ error: "Room not found" }, { status: 404 });
      }

      return NextResponse.json({ room });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Request failed",
      },
      { status: 500 },
    );
  }
}
