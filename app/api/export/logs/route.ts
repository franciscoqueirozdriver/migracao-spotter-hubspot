
import { NextResponse } from "next/server";
import { getLogs } from "@/lib/export/exportLogger";

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    lines: getLogs(),
    lastUpdatedAt: new Date().toISOString(),
  });
}
