// Gera JWT_SECRET + chaves anon/service_role (HS256) para a stack de teste.
import { createHmac, randomBytes } from "node:crypto";

const secret = process.env.JWT_SECRET || randomBytes(32).toString("hex");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (payload) => {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 10 * 365 * 86400;
console.log(`JWT_SECRET=${secret}`);
console.log(`ANON_KEY=${sign({ role: "anon", iss: "supabase", iat, exp })}`);
console.log(`SERVICE_ROLE_KEY=${sign({ role: "service_role", iss: "supabase", iat, exp })}`);
