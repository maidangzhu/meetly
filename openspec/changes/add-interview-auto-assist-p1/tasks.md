# Tasks: add-interview-auto-assist-p1

## 1. Question Detection

- [x] Add a deterministic `QuestionDetector`.
- [x] Classify candidate kind: technical, behavioral, system design, product, general.
- [x] Add confidence score and reason.
- [x] Ignore filler/too-short segments.
- [ ] Add unit tests for common Chinese and English interview prompts.

## 2. Low-Distraction Hint

- [x] Add an `autoAssistCandidate` state object to the interview session.
- [x] Show a compact island hint when a candidate is detected.
- [x] Expire hint after a short duration.
- [x] Allow manual dismissal.
- [x] Log hint lifecycle events.

## 3. Prefetch

- [x] Add background prefetch for high-confidence candidates.
- [x] Store prefetched answer in a short-lived cache.
- [x] Cancel/supersede old prefetch when a better candidate arrives.
- [x] On Enter, use cached answer if it matches the current candidate.
- [x] Fall back to normal Ask if no cache is available.

## 4. Cooldown and Dedupe

- [x] Add hint cooldown.
- [x] Add candidate text similarity dedupe.
- [x] Add cache expiry.
- [x] Add logs for cooldown/dedupe/cache decisions.

## 5. Verification

- [x] `pnpm build`
- [x] `cargo check`
- [ ] Manual test: interviewer asks a question; island shows `Question detected · Press Enter`.
- [ ] Manual test: repeated filler transcript does not show hints.
- [ ] Manual test: high-confidence question prefetches; Enter shows answer faster than cold Ask.
- [ ] Manual test: repeated similar questions do not spam hints.
