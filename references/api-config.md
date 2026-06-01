# API Configuration

## Default configuration

When the user has not supplied `api_config`, the scripts read these values:

- `base_url`: `https://idealab.alibaba-inc.com/api/openai/v1`
- `model`: `gemini-3.1-flash-image-preview`
- `api_key`: from `.env` file (`IDEALAB_API_KEY=...`)

The skill calls `{base_url}/chat/completions` with OpenAI-compatible multimodal payload: text + 2 image_url parts (template, product) encoded as base64 data URIs.

## Override per-call (one-off)

Pass `api_config` inside the generate_batch or retry_batch arguments:

```bash
node scripts/generate_batch.js '{
  "template_image": "...",
  "product_paths": [...],
  "prompt": "...",
  "output_dir": "...",
  "api_config": {
    "base_url": "https://openrouter.ai/api/v1",
    "api_key": "sk-or-xxx",
    "model": "google/gemini-2.5-flash-image"
  }
}'
```

Whenever `api_config.base_url` or `api_config.api_key` is set, the script treats the call as **non-default**, which removes the 10-image-per-batch limit.

## Override permanently (write to .env)

Use the config script to update `.env`:

```bash
node scripts/config.js '{
  "api_key": "sk-or-xxx",
  "base_url": "https://openrouter.ai/api/v1",
  "model": "google/gemini-2.5-flash-image"
}'
```

Subsequent calls without `api_config` will use these new defaults.

## Compatible providers

Any service that exposes an OpenAI-compatible Chat Completions endpoint with multimodal (image) input and image output works. Verified families:

- ideaLAB (default, Alibaba internal proxy)
- OpenAI (`gpt-image-1` via images.edit endpoint requires separate adapter; for chat-completions style, use Gemini-via-OpenAI proxies)
- OpenRouter (`google/gemini-*-flash-image` models)
- Aliyun DashScope (Tongyi Wanxiang via OpenAI-compatible mode)
- ByteDance Volcano Ark (Doubao image models)
- Self-hosted vLLM / LiteLLM with image-output model

If the provider does not speak OpenAI-compatible chat completions, the skill cannot reach it directly. Suggest the user front it with a LiteLLM proxy.

## Response shape

The script attempts to extract base64 image data from any of these fields (different providers vary):

1. `choices[0].message.images[0].url` (data URI)
2. `choices[0].message.content[].image_url.url` (when content is array)
3. `choices[0].message.content[].image.data` (raw base64)
4. `choices[0].message.content` regex `data:image/...;base64,XXX` (string content)

If none match, the script returns `success: false` with error "响应里没找到图片". Common causes: model does not support image output; provider returns a different field name.

## Model selection guidance

- For e-commerce product replacement (this skill's primary use), `gemini-3.1-flash-image-preview` is the default; it handles product subject extraction reasonably well.
- For higher fidelity, try `gemini-2.5-flash-image` (slightly older, occasionally more conservative).
- Stable Diffusion / Imagen / DALL-E variants require different request shapes; not directly supported.
