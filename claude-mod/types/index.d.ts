export type Mark = 'pending' | 'running' | 'done' | 'failed'
// level: how deep in the page the step acts (page 0, then a form or dialog, a component, an iframe, one each).
// ms: how long the call took; route: one of a known route's steps, else the tester found it by exploring.
export type Step = { id: string; text: string; mark: Mark; error?: string; level?: number; ms?: number; route?: boolean }
export type Scenario = {
  title: string
  kind: 'positive' | 'negative'
  status: 'pending' | 'running' | 'PASS' | 'FAIL'
  // Example mapping: the requirement (rule) it is an example of.
  requirement?: string
  reason?: string
  // The user it runs as: from the plan, then the user the tester was logged in as when it started.
  persona?: string
  source?: 'requirement' | 'brief' | 'org rule'
  steps: Step[]
}
export type Tester = {
  agentId: string
  label: string
  feature?: string
  isDone: boolean
  // When the tester was spawned and when it answered, in epoch ms, for the finished block's run time.
  startedAt?: number
  endedAt?: number
  // The key that picks it while it runs, 1 to 9: kept to its end once it has one; a tester past the ninth has none
  // until a digit is free.
  digit?: number
  // BLOCKED: it stopped to ask (asked holds the question) and waits for an answer before it continues.
  // STOPPED: no verdict and no question: its turn did not answer, answered with a scenario unfinished (NONE before),
  // or answered with no text after no step.
  // DONE: it answered with a plain report and ran no scenario.
  result?: 'PASS' | 'FAIL' | 'DONE' | 'STOPPED' | 'NONE' | 'BLOCKED'
  // A FAIL that ends on a last-line BLOCKED keeps the FAIL, with the question in asked: it waits like a BLOCKED.
  asked?: string
  // Why the last turn did not answer, in one word (aborted, refused, error), drawn after STOPPED or FAIL.
  cause?: string
  // kept: how the run before a resume ended, until an sf-tester call makes the resume a run of its own.
  // turnAt: when its last turn ended, also when that turn was cut and the earlier ending stayed.
  kept?: End
  turnAt?: number
  // Clear or Dismiss hid it; it shows again, history and all, once it goes on.
  hidden?: boolean
  // Steps outside any scenario: all of them when the tester marks none.
  steps: Step[]
  scenarios?: Scenario[]
  // A form or dialog is open, so the steps after its opener sit one level in; parents is the map's child -> parent.
  form?: boolean
  parents?: Record<string, string>
  // The last sf_login_as user; the toasts the page raised, newest last; page errors read so far (unset until read).
  persona?: string
  // window: which click, save or upload raised it, counted per tester, so a repeat after a new action is listed.
  toasts?: { text: string; at?: number; window?: number }[]
  window?: number
  errors?: number
}
// A run's ending: what a cut turn after a resume gives back whole.
export type End = Pick<Tester, 'isDone' | 'result' | 'asked' | 'cause' | 'hidden' | 'startedAt' | 'endedAt'>

declare module 'claude-code' {
  interface PluginState {
    'sf-tester-pane': { testers: Tester[]; blink: boolean; open: string[]; told: boolean; picked: string }
  }
}
