# Product video script

Target length: 2.5-3.5 minutes. Tone: friendly, professional, plain English - describing what's
on screen, never reading out UI labels verbatim. Each scene below has the **narration** (what
edge-tts speaks) and the **caption** (the on-screen text overlay, usually shorter).

**Voice: pick one, WAITING for your OK before Part 2 records anything.**

| # | Voice | Character |
|---|---|---|
| 1 | `en-US-AriaNeural` (female, US) | Warm, confident, slightly upbeat - common choice for SaaS product videos |
| 2 | `en-US-GuyNeural` (male, US) | Clear, measured, a bit more formal/corporate |
| 3 | `en-GB-SoniaNeural` (female, UK) | Crisp, professional, good fit for an academic/research audience |

My recommendation: **Aria** - friendly without being casual, reads naturally at the `-5%` rate
Part 3 applies. Happy to go with any of the three.

---

## Scenes

### 1. ANIMATED intro (5s)
**Narration:** "Conference Management System. Run your academic conference in one place."
**Caption:** Conference Management System

### 2. Home page -> conference page
**Narration:** "From a public home page listing every conference, to a full event page with
dates, tracks, and a live programme."
**Caption:** One page per conference - dates, tracks, programme

### 3. ANIMATED feature card: "Submit & review" (3s)
**Narration:** "Authors submit. Reviewers review, blind."
**Caption:** Submit & review

### 4. Author submits an abstract
**Narration:** "Authors sign in, write an abstract, attach their paper, and submit - no email
back-and-forth, just a tracked submission with its own code."
**Caption:** New abstract -> instant submission code

### 5. Reviewer reviews (blind)
**Narration:** "Reviewers see the paper, never the author's name, and submit a structured
review in minutes."
**Caption:** Blind review
*(callout, 2s, over the paper view): "Blind review"*

### 6. Convenor accepts
**Narration:** "The convenor's dashboard surfaces exactly what needs attention - here, a
reviewed paper ready for a decision."
**Caption:** One dashboard, every open item

### 7. Programme scheduling
**Narration:** "Accepted papers get dropped straight into the programme grid, and the public
page updates the moment it's published."
**Caption:** Scheduled -> live on the public programme

### 8. ANIMATED feature card: "Register & check in" (3s)
**Narration:** "Attendees register. Staff check them in."
**Caption:** Register & check in

### 9. Attendee registers
**Narration:** "Registering takes under a minute, and ends with a ticket - QR code included."
**Caption:** My ticket, with a scannable QR code

### 10. Staff check-in
**Narration:** "At the door, staff search, tap check in, and the count updates live."
**Caption:** Check-in desk

### 11. ANIMATED feature card: "Certificates in one click" (3s)
**Narration:** "Certificates, generated and released in one click."
**Caption:** Certificates in one click

### 12. Convenor generates certificates
**Narration:** "With a branded template already in place, the convenor generates certificates
for every checked-in attendee and releases them at once."
**Caption:** Generate -> Release

### 13. Attendee downloads certificate
**Narration:** "Attendees download a real PDF certificate straight from their portal."
**Caption:** My certificates

### 14. Verify / revoke
**Narration:** "Every certificate carries a QR code that verifies it instantly - and if the
convenor ever needs to revoke one, that shows up immediately too."
**Caption:** Tamper-proof QR verification
*(callout, 2s, over the verify page): "Tamper-proof QR"*

### 15. Super admin
**Narration:** "And across every conference, a platform dashboard keeps an eye on system
health."
**Caption:** Platform health, at a glance

### 16. ANIMATED outro (5s)
**Narration:** "Conference Management System. Abstracts, reviews, programme, registration,
certificates."
**Caption:** Abstracts · Reviews · Programme · Registration · Certificates

---

## Word count / timing check

~230 words total narration. At ~140 wpm (edge-tts `-5%` rate lands close to this), that's
roughly **100s of speech**. With 5 animated scenes padded to their fixed 3-5s each (~19s, already
counted above) and the 11 real scenes each running a few seconds longer than their narration
alone (camera motion, UI reaction time, the 2s callouts), total runtime should land comfortably
in the 2.5-3.5 minute target once Part 3's per-scene holds are applied - confirmed for real with
ffprobe once scenes are actually recorded and voiced, not assumed here.
