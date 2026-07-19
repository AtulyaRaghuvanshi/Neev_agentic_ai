import { getDatabase } from "@netlify/database";

export function getDb() {
  return getDatabase();
}
