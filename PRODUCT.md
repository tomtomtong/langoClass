# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
HK older adults (長者) attending community centres, playing LangoClass as a group. A teacher or facilitator projects the host screen on a large display; participants join with phones or tablets by room code and answer on their own device. Language: Cantonese first, also Mandarin and English. (Source: user, this session.)

## Product Purpose
LangoClass hk-elderly is a live quiz/lesson game for seniors: the host runs questions, participants answer, questions are read aloud with TTS. Success: every participant can follow and answer without help.

## Operating Context
Host screen on a classroom projector viewed from several metres; participants on personal phones/tablets (`/hk/join.html`, `/hk/host.html`, `public/hk/elderly.css`). Question speech via ElevenLabs eleven_v4.

## Capabilities and Constraints
Supported languages: English, Cantonese (yue), Mandarin Traditional (zh). Strings in `public/i18n-hk-elderly.js`. Separate deploy via `APP_VARIANT=hk-elderly`; the main classroom app must not change.

## Product Principles
1. The question is the star on the big screen; everything else recedes.
2. One screen, one action.
3. Never rely on colour alone to tell answers apart.
4. Calm, not busy: minimal motion, no flashing.

## Accessibility & Inclusion
Older-adult vision and motor needs: large type, contrast of 7:1 or more for body text, touch targets of 64px or more on participant devices, reduced motion respected.
