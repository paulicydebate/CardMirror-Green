# Cut a card with a chat AI (copy-paste)

Status: implemented in the app and tested locally with automated tests and screenshots (2026-10-26). **Not yet tried by the user with Grok.**

Lets any chat AI (the Grok app on PC, Mac or phone; ChatGPT; Claude chat) cut a card without an API key. CardMirror Green does the non-AI part: it builds the prompt, checks the reply against the card's text, and applies the formatting.

## Use

1. Paste the article into a card as usual: tag, cite, body paragraphs.
2. Put the cursor in the card and run **Cut Card with Chat AI (Copy/Paste)** from the command bar (also in the AI ribbon group).
3. Optionally say what the card should prove (prefilled from the tag) and how many words to highlight. Press **Copy prompt** and paste it into the chat AI.
4. Copy the AI's whole reply and paste it into the dialog. It is checked as you paste: the dialog lists what was found and every quote that is NOT in the card.
5. **Apply to card**. One step: Ctrl+Z / Cmd+Z undoes it. The dialog can stay open while you switch to the chat app.

Options: replace the card's existing underline/emphasis/highlight (on by default); use the AI's tag (on by default only when the card has no tag).

## Safety rules (enforced in code, not by trusting the AI)

- Only `card_body` paragraphs can be quoted, never the tag, cite or undertags.
- Every quote must be found in the card's text. Missing, paraphrased or invented quotes are rejected and listed; they are never applied.
- A quote cannot cross a paragraph boundary.
- Protected text (bracketed omissions, ALT TEXT, translator notes, custom Shrink protections) and inline images/footnotes are blanked, so they cannot be highlighted.
- Matching tolerates what chat apps do to text: curly vs straight quotes, dash variants, whitespace and line breaks, invisible characters, "…" vs "...", quotes wrapped in quotation marks. Whole-word matches are preferred; case-insensitive matches are accepted and reported.
- Repeated words are resolved by reading order. A quote found only earlier than the previous one is used and reported as out of order.
- Highlighted text that is not underlined or boxed gets underlined too, and the dialog says so. Emphasis needs no separate underline: the Emphasis style is underlined, and Underline/Emphasis are exclusive character styles, as in Word.
- Highlight color: the document's own color when every highlight in it agrees, otherwise green.

## Reply format `cardmirror.cut.v1`

The prompt asks for exactly this, in a ```json block. Outside agents (Claude Code, Codex) can write it directly.

```json
{
  "format": "cardmirror.cut.v1",
  "tag": "one-sentence tag",
  "underline": ["exact quote", "exact quote"],
  "emphasis": ["exact quote"],
  "highlight": ["exact quote", "exact quote"]
}
```

- All fields except one quote list or the tag are optional. `format`, if present, must be `cardmirror.cut.v1`.
- Quotes are exact runs of the card's body text, in reading order. Non-adjacent words are separate quotes.
- The parser accepts surrounding chatter, a missing fence, trailing commas and curly quotes used as JSON delimiters. Limits: 400 quotes per list, 5,000 characters per quote, 1,000 per tag.

## Code

| File | Responsibility |
|---|---|
| `src/cutting/chat-cut.ts` | Pure: prompt builder, reply parser, normalizing matcher with offset map, report |
| `src/editor/chat-cut-apply.ts` | Reads the card at the cursor (body text, protected spans, doc-position segments); applies a report as one transaction |
| `src/editor/chat-cut-ui.ts` | The dialog and the `chatCutCard` command target |
| `tests/cutting/chat-cut.test.ts`, `tests/editor/chat-cut-apply.test.ts`, `tests/editor/chat-cut-ui.test.ts` | Matcher, editor glue and dialog tests |

## Not done yet

- Cutting a raw article that is not yet in a card (the user pastes it into a card first).
- Shortening the card body (bracketed omissions) from the AI's suggestion.
- A command-line version for agents to apply replies to .docx/.cmir files.
- Batch cutting several cards in one prompt.
