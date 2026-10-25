import { cronHandler } from "@/services/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = (req: Request) => cronHandler(req, "retry");
