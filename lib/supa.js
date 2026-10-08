import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.1/+esm";

let client;
export function getClient() {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return client;
}

export async function checkIn(cls, num, name) {
  const { data, error } = await getClient().rpc("check_in", { p_class: cls, p_number: num, p_name: name });
  if (error) throw error;
  return data; // {ok, exam_open, submitted}
}

export async function downloadAudio(fileName) {
  const { data, error } = await getClient().storage.from("audio").download(fileName);
  if (error) throw error;
  return data; // Blob
}
