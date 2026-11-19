// A poll: one question with no right answer, asked in the middle of a lesson. It gives no
// points and never reaches a leaderboard. It is not a game; it lives on the session.
//
//   start_poll { id, question, options }   host only; options are 2 to 4 strings.
//                                          Told to everyone as "poll_state".
//   send_poll_vote { id, index }           student; one vote each, and it stays.
//   end_poll {}                            host only; told to everyone as "poll_state" { open: false }.
//
// After every vote the host gets "poll_votes" with a count for each option. Nobody is told
// who chose what.
import { clip, done, isHost, isStudent } from "./room-core.js";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

export function startPoll(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can start a poll." } });
  const question = clip(data.question, 200);
  const options = (Array.isArray(data.options) ? data.options : [])
    .map((option) => clip(option, 60))
    .filter(Boolean)
    .slice(0, MAX_OPTIONS);
  if (!question || options.length < MIN_OPTIONS) {
    return done(state, { ack: { ok: false, error: "A poll needs a question and at least two options." } });
  }
  state.session.poll = { id: clip(data.id, 64) || `poll-${ctx.now}`, question, options, votes: {} };
  return done(state, {
    ack: { ok: true, id: state.session.poll.id },
    broadcasts: [pollStateEvent(state.session.poll), pollVotesEvent(state.session.poll)],
  });
}

export function sendPollVote(state, data, ctx) {
  const poll = state.session.poll;
  if (!poll || (data.id && data.id !== poll.id)) return done(null, { ack: { ok: false, error: "This poll has closed." } });
  if (!isStudent(ctx)) return done(null, { ack: { ok: false, error: "Join the class first." } });
  if (ctx.playerId in poll.votes) return done(null, { ack: { ok: true, index: poll.votes[ctx.playerId] } });
  const index = Number(data.index);
  if (!Number.isInteger(index) || index < 0 || index >= poll.options.length) {
    return done(null, { ack: { ok: false, error: "Pick one of the options." } });
  }
  poll.votes[ctx.playerId] = index;
  return done(state, { ack: { ok: true, index }, broadcasts: [pollVotesEvent(poll)] });
}

export function endPoll(state, data, ctx) {
  if (!isHost(ctx)) return done(state, { ack: { ok: false, error: "Only the host can end a poll." } });
  const poll = state.session.poll;
  if (!poll) return done(null, { ack: { ok: true } });
  return done(state, { ack: { ok: true, ...tally(poll) }, broadcasts: closePoll(state) });
}

// Closes the open poll, if there is one, and returns what to tell the room. Starting the
// next exercise calls this too, so a poll can never sit on top of a question.
export function closePoll(state) {
  const poll = state.session.poll;
  if (!poll) return [];
  delete state.session.poll;
  return [{ event: "poll_state", data: { id: poll.id, open: false } }];
}

// What a student who joins (or reloads) during a poll needs to show it.
export function pollForStudent(state, playerId) {
  const poll = state.session.poll;
  if (!poll) return null;
  return { ...pollStateEvent(poll).data, myVote: poll.votes[playerId] ?? null };
}

function pollStateEvent(poll) {
  return { event: "poll_state", data: { id: poll.id, question: poll.question, options: poll.options, open: true } };
}

function pollVotesEvent(poll) {
  return { event: "poll_votes", hostOnly: true, data: tally(poll) };
}

function tally(poll) {
  const counts = poll.options.map(() => 0);
  for (const index of Object.values(poll.votes)) counts[index] += 1;
  return { id: poll.id, counts, voters: Object.keys(poll.votes).length };
}
