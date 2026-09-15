---
name: Groq reasoning visibility
description: Durable guardrails for selecting Groq chat models and preventing internal reasoning from reaching users.
---

Check the live Groq model inventory before changing model IDs. The previously requested Llama 3.3 model was unavailable to this workspace even though it is a commonly documented Groq model.

**Why:** A static model switch passed typechecking but failed at runtime with `model_not_found`. The available Qwen model supports disabling reasoning with `reasoning_effort: "none"` and hiding it with `reasoning_format: "hidden"`.

**How to apply:** Disable/hide reasoning only with parameters supported by the selected model (do not carry Qwen-specific parameters into Llama calls). Retain incremental frontend sanitization because tags can be split across SSE chunks. Recheck the models endpoint and a minimal completion before any future model replacement; a valid key does not imply access to a particular model.