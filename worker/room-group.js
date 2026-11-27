// A room's side of a group (worker/group-rules.js, worker/group.js): which group it is in, and the
// checks for the host's events. The calls to the group itself are made by room.js.
//
//   join_group { code, lessonId }   host only; the room joins the group of that code
//   leave_group {}                  host only
//   group_pull {}                   host only; asks the group for another room's answer to watch
import { clip, isHost } from "./room-core.js";
import { groupCode } from "./group-rules.js";

// What a host's join_group asks for, or why it cannot be done.
export function joinCheck(state, data, ctx) {
  if (!isHost(ctx)) return { ok: false, error: "Only the host can link this class to others." };
  const code = groupCode(data?.code);
  if (!code) return { ok: false, error: "A group code is four digits." };
  const lessonId = clip(data?.lessonId, 120);
  if (!lessonId) return { ok: false, error: "Which lesson is this?" };
  return {
    ok: true,
    code,
    lessonId,
    lessonTitle: clip(data?.lessonTitle, 120),
    rate: Number(data?.rate),
    previous: state?.session?.group?.code || "",
  };
}

export function hostCheck(state, ctx) {
  if (!isHost(ctx)) return { ok: false, error: "Only the host can do that." };
  const code = state?.session?.group?.code;
  if (!code) return { ok: false, error: "This class is not linked to a group." };
  return { ok: true, code };
}

export function setRoomGroup(state, code) {
  state.session.group = { code };
}

export function clearRoomGroup(state) {
  delete state.session.group;
}

export const roomGroupCode = (state) => state?.session?.group?.code || "";
