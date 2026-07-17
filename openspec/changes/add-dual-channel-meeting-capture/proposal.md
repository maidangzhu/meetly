# Proposal: add-dual-channel-meeting-capture

## Why

Meetly currently treats system audio and microphone audio as mutually exclusive.
That cannot represent a remote meeting: system audio contains the remote
participants while the microphone contains the local user. The existing browser
microphone path can also interfere with the microphone used by Feishu and other
meeting applications.

## What

- Replace the interview/meeting setup choice with remote meeting/in-person meeting.
- Start system audio and a native microphone capture together for remote meetings.
- Start only native microphone capture for in-person meetings.
- Preserve explicit source and speaker identity for every transcript segment.
- Merge timestamped transcript segments for Coach context; never mix raw PCM.
- Allow either remote-meeting channel to keep running if the other channel fails.

## Non-goals

- Speaker diarization within one channel.
- Mixing system and microphone PCM into one recording.
- Persisting raw meeting audio.
