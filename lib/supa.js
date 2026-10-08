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
  return data; // {ok, exam_open, submitted, is_teacher}
}

export async function downloadAudio(fileName) {
  const { data, error } = await getClient().storage.from("audio").download(fileName);
  if (error) throw error;
  return data; // Blob
}

function teacherArgs({ cls, num, name }) {
  return { p_class: cls, p_number: num, p_name: name };
}

export async function getTeacherDashboard(identity) {
  const { data, error } = await getClient().rpc("teacher_dashboard", teacherArgs(identity));
  if (error) throw error;
  return data;
}

export async function setExamOpen(identity, cls, open) {
  const { data, error } = await getClient().rpc("teacher_set_exam_open", {
    ...teacherArgs(identity), p_target_class: cls, p_open: open,
  });
  if (error) throw error;
  return data;
}

export async function returnSubmission(identity, submissionId) {
  const { data, error } = await getClient().rpc("teacher_return_submission", {
    ...teacherArgs(identity), p_submission_id: submissionId,
  });
  if (error) throw error;
  return data;
}

export async function getRecordingUrl(identity, path) {
  const teacherClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: {
      "x-teacher-class": String(identity.cls),
      "x-teacher-number": String(identity.num),
      "x-teacher-name": encodeURIComponent(identity.name),
    } },
  });
  const { data, error } = await teacherClient.storage.from("recordings").createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
