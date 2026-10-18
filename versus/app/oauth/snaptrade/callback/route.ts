// The redirect URI already registered on the SnapTrade OAuth app during the spike.
// Same handler as /auth/callback; route config is declared here because Next reads it statically.
export { GET } from "../../../auth/callback/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
