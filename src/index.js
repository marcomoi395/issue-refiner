import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions';

// Whitelisted GitHub labels mapping
const LABELS = {
  bug: { color: "d73a4a", description: "Something is broken" },
  enhancement: { color: "a2eeef", description: "New feature or improvement" },
  refactor: { color: "cfd3d7", description: "Code improvement without behavior change" },
  docs: { color: "0075ca", description: "Documentation updates" },
  chore: { color: "fef2c0", description: "Maintenance task" },
  ui: { color: "bfdadc", description: "User interface work" },
  backend: { color: "5319e7", description: "Backend work" },
  api: { color: "1d76db", description: "API work" },
  infra: { color: "0052cc", description: "Infrastructure work" },
  database: { color: "006b75", description: "Database work" },
  performance: { color: "fbca04", description: "Performance improvements" },
  security: { color: "b60205", description: "Security-related work" },
  test: { color: "0e8a16", description: "Testing work" }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/') {
      return new Response('Not found', { status: 404 });
    }

    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 65536) {
      return new Response('Payload too large', { status: 413 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');

    if (!signature || !timestamp) {
      return new Response('Invalid request signature', { status: 401 });
    }

    const rawBody = await request.text();
    const isValid = await verifyKey(rawBody, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!isValid) {
      console.error('Signature verification failed');
      return new Response('Invalid request signature', { status: 401 });
    }

    let interaction;
    try {
      interaction = JSON.parse(rawBody);
    } catch (err) {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (interaction.type === InteractionType.PING) {
      return new Response(JSON.stringify({ type: InteractionResponseType.PONG }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Guild ID Guard
    if (interaction.guild_id !== env.ALLOWED_GUILD_ID) {
      ctx.waitUntil(logEvent(env, {
        name: 'guild_rejected',
        guildId: interaction.guild_id,
        userId: getUserId(interaction)
      }));
      return new Response(JSON.stringify({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          flags: 64,
          content: 'Server không được phép dùng bot này.'
        }
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (interaction.data && interaction.data.name === 'add-issue') {
        const textOpt = interaction.data.options?.find(o => o.name === 'text' && o.type === 3);
        const text = textOpt ? textOpt.value.trim() : '';
        if (!text) {
          return new Response(JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: 64,
              content: 'Thiếu nội dung issue.'
            }
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        let repo;
        try {
          repo = resolveRepo(interaction.guild_id, interaction.channel_id, env.CHANNEL_REPO_MAP_JSON);
        } catch (err) {
          ctx.waitUntil(logEvent(env, {
            name: 'repo_not_mapped',
            guildId: interaction.guild_id,
            channelId: interaction.channel_id,
            userId: getUserId(interaction),
            text
          }));
          return new Response(JSON.stringify({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              flags: 64,
              content: err.message
            }
          }), { headers: { 'Content-Type': 'application/json' } });
        }

        ctx.waitUntil(processAddIssue(interaction, env, repo, text));

        // Return deferred response within 3s limit
        return new Response(JSON.stringify({
          type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            flags: 64
          }
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
      const customId = interaction.data?.custom_id || '';
      if (customId.startsWith('issue_confirm:') || customId.startsWith('issue_cancel:')) {
        ctx.waitUntil(processComponent(interaction, env));
        return new Response(JSON.stringify({
          type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE
        }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: 64,
        content: 'Unsupported interaction.'
      }
    }), { headers: { 'Content-Type': 'application/json' } });
  }
};

// Pure and business logic helpers

export function getUserId(interaction) {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";
}

export function resolveRepo(guildId, channelId, channelRepoMapJson) {
  let map;
  try {
    map = JSON.parse(channelRepoMapJson);
  } catch (err) {
    throw new Error('Cấu hình repo mapping lỗi.');
  }

  const repo = map.guilds?.[guildId]?.channels?.[channelId];
  if (!repo) {
    throw new Error('Channel này chưa được map với repo nào.');
  }

  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('Repo mapping không hợp lệ.');
  }

  return repo;
}

export function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return ["enhancement"];
  const unique = [...new Set(labels.map(l => String(l).toLowerCase().trim()))];
  const filtered = unique.filter(l => l in LABELS);
  return filtered.length > 0 ? filtered : ["enhancement"];
}

export function parseOpenAIResponse(data) {
  if (data.error) {
    throw new Error(`OpenAI error: ${JSON.stringify(data.error)}`);
  }
  let text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("No parseable text in OpenAI response");
  }
  return JSON.parse(text);
}

// REST & Integration helpers

async function editOriginalInteraction(applicationId, token, payload) {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    console.error(`Failed to edit interaction message: ${res.status} ${await res.text()}`);
  }
}

async function sendFollowupInteraction(applicationId, token, payload) {
  const url = `https://discord.com/api/v10/webhooks/${applicationId}/${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    console.error(`Failed to send followup interaction: ${res.status} ${await res.text()}`);
  }
}

async function githubFetch(env, path, init = {}) {
  const url = `https://api.github.com${path}`;
  const headers = {
    'Authorization': `Bearer ${env.GITHUB_PAT}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', // Recommended current GitHub API version, 2026-03-10 was placeholder
    'User-Agent': 'discord-issue-worker',
    ...init.headers
  };
  return fetch(url, { ...init, headers });
}

async function ensureLabels(env, repo, desiredLabels) {
  const res = await githubFetch(env, `/repos/${repo}/labels?per_page=100`);
  if (!res.ok) {
    throw new Error(`GitHub error listing labels: ${res.status} ${await res.text()}`);
  }
  const existingLabels = await res.json();
  const existingNames = new Set(existingLabels.map(l => l.name.toLowerCase()));

  for (const labelName of desiredLabels) {
    if (!existingNames.has(labelName.toLowerCase())) {
      const labelConfig = LABELS[labelName];
      if (labelConfig) {
        const createRes = await githubFetch(env, `/repos/${repo}/labels`, {
          method: 'POST',
          body: JSON.stringify({
            name: labelName,
            color: labelConfig.color,
            description: labelConfig.description
          })
        });
        if (!createRes.ok && createRes.status !== 422) {
          throw new Error(`GitHub error creating label ${labelName}: ${createRes.status} ${await createRes.text()}`);
        }
      }
    }
  }
}

async function logEvent(env, event) {
  if (!env.LOG_WEBHOOK_URL) return;
  try {
    const timestamp = new Date().toISOString();
    const content = `[${event.name.toUpperCase()}] at ${timestamp}\n` +
      `- User: ${event.userId || 'N/A'}\n` +
      `- Guild: ${event.guildId || 'N/A'}\n` +
      `- Channel: ${event.channelId || 'N/A'}\n` +
      (event.repo ? `- Repo: ${event.repo}\n` : '') +
      (event.text ? `- Input note: ${event.text}\n` : '') +
      (event.issueUrl ? `- Issue URL: ${event.issueUrl}\n` : '') +
      (event.status ? `- Status/Error: ${event.status}\n` : '');

    await fetch(env.LOG_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
  } catch (err) {
    console.error('Failed to log event to webhook', err);
  }
}

async function processAddIssue(interaction, env, repo, text) {
  const userId = getUserId(interaction);
  try {
    const systemPrompt = `You are an automated GitHub Issue generator for a developer's personal project.

Task: Convert short, unorganized user notes into extremely concise, to-the-point GitHub Issues. NO explanations, NO greetings, NO fluff. Generate title and body in the SAME LANGUAGE as the user's input. Keep GitHub labels in English.

Output MUST match the supplied JSON schema.

Rules:
- Create exactly one issue.
- Do not invent screen names, API names, tables, fields, files, or business context not present in the input.
- If input is vague, make a minimal actionable issue without guessing hidden details.
- Title must start with a bracketed prefix like [UI], [Bug], [Feature], [Refactor], [Docs], [Chore], [API], [Infra], [DB], [Security], [Performance], or [Test].
- Labels must be selected only from: bug, enhancement, refactor, docs, chore, ui, backend, api, infra, database, performance, security, test.
- Labels must contain at most 3 items and should prefer 1 work-type label plus 1-2 scope labels.
- Body must be Markdown with exactly 2 sections and no extra sections.
- For Vietnamese input, use headings exactly: **Mục tiêu:** and **To-do:**.
- For English input, use headings exactly: **Objective:** and **To-do:**.
- Objective/Mục tiêu must be exactly one sentence.
- To-do must be a markdown checklist using - [ ].`;

    const userMessage = `Repo: ${repo}\nUser note: ${text}`;

    const schema = {
      "type": "object",
      "additionalProperties": false,
      "required": ["title", "labels", "body"],
      "properties": {
        "title": { "type": "string", "minLength": 1, "maxLength": 120 },
        "labels": {
          "type": "array",
          "maxItems": 3,
          "items": { "type": "string", "enum": ["bug", "enhancement", "refactor", "docs", "chore", "ui", "backend", "api", "infra", "database", "performance", "security", "test"] }
        },
        "body": { "type": "string", "minLength": 1, "maxLength": 4000 }
      }
    };

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage }
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "github_issue",
                strict: true,
                schema: schema
              }
            }
          })
        });

    if (!response.ok) {
      throw new Error(`OpenAI API failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const parsed = parseOpenAIResponse(data);

    if (!parsed.title || !parsed.body) {
      throw new Error("Invalid title or body in normalized response.");
    }

    const finalLabels = normalizeLabels(parsed.labels);

    const pendingData = {
      interactionId: interaction.id,
      applicationId: interaction.application_id,
      interactionToken: interaction.token,
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      userId: userId,
      repo: repo,
      issue: {
        title: parsed.title,
        labels: finalLabels,
        body: parsed.body
      },
      createdAt: new Date().toISOString()
    };

    // Store in KV with TTL 300 seconds
    await env.PENDING_ISSUES.put(`pending:${interaction.id}`, JSON.stringify(pendingData), { expirationTtl: 300 });

    const content = `**Repo:** ${repo}\n**Title:** ${parsed.title}\n**Labels:** ${finalLabels.join(', ')}\n\n${parsed.body}`;

    await editOriginalInteraction(interaction.application_id, interaction.token, {
      content,
      components: [{
        type: 1,
        components: [
          { type: 2, custom_id: `issue_confirm:${interaction.id}`, style: 3, label: "Confirm" },
          { type: 2, custom_id: `issue_cancel:${interaction.id}`, style: 4, label: "Cancel" }
        ]
      }],
      allowed_mentions: { parse: [] }
    });
  } catch (err) {
    console.error('Normalization error', err);
    await logEvent(env, {
      name: 'openai_normalize_failed',
      guildId: interaction.guild_id,
      channelId: interaction.channel_id,
      userId: userId,
      text,
      status: err.message
    });
    await editOriginalInteraction(interaction.application_id, interaction.token, {
      content: 'Không thể chuẩn hóa nội dung issue. Vui lòng mô tả rõ hơn.',
      components: []
    });
  }
}

async function processComponent(interaction, env) {
  const customId = interaction.data?.custom_id || '';
  const userId = getUserId(interaction);
  const [action, targetId] = customId.split(':');

  const pendingStr = await env.PENDING_ISSUES.get(`pending:${targetId}`);
  if (!pendingStr) {
    await editOriginalInteraction(interaction.application_id, interaction.token, {
      content: 'Preview đã hết hạn hoặc đã được xử lý.',
      components: []
    });
    return;
  }

  const pending = JSON.parse(pendingStr);

  // Ownership Check
  if (pending.userId !== userId) {
    await sendFollowupInteraction(interaction.application_id, interaction.token, {
      content: 'Chỉ người tạo preview mới được bấm nút này.',
      flags: 64
    });
    return;
  }

  if (action === 'issue_cancel') {
    await env.PENDING_ISSUES.delete(`pending:${targetId}`);
    await editOriginalInteraction(interaction.application_id, interaction.token, {
      content: 'Đã hủy tạo issue.',
      components: []
    });
    await logEvent(env, {
      name: 'issue_cancelled',
      guildId: pending.guildId,
      channelId: pending.channelId,
      userId: pending.userId,
      repo: pending.repo
    });
    return;
  }

  if (action === 'issue_confirm') {
    // Prevent double submits
    await editOriginalInteraction(interaction.application_id, interaction.token, {
      content: 'Đang tạo GitHub issue...',
      components: []
    });

    try {
      // Ensure missing whitelisted labels exist in repo
      await ensureLabels(env, pending.repo, pending.issue.labels);

      // Create issue
      const issueRes = await githubFetch(env, `/repos/${pending.repo}/issues`, {
        method: 'POST',
        body: JSON.stringify({
          title: pending.issue.title,
          body: pending.issue.body,
          labels: pending.issue.labels
        })
      });

      if (!issueRes.ok) {
        throw new Error(`GitHub create issue failed: ${issueRes.status} ${await issueRes.text()}`);
      }

      const issueData = await issueRes.json();
      if (!issueData.html_url) {
        throw new Error('GitHub response missing html_url');
      }

      await env.PENDING_ISSUES.delete(`pending:${targetId}`);

      await editOriginalInteraction(interaction.application_id, interaction.token, {
        content: `Đã tạo issue: ${issueData.html_url}`,
        components: []
      });

      await logEvent(env, {
        name: 'issue_created',
        guildId: pending.guildId,
        channelId: pending.channelId,
        userId: pending.userId,
        repo: pending.repo,
        issueUrl: issueData.html_url
      });
    } catch (err) {
      console.error('GitHub issue creation failed', err);
      // Clean up KV on terminal failures as specified
      await env.PENDING_ISSUES.delete(`pending:${targetId}`).catch(e => console.error('Failed to delete pending KV key', e));

      await editOriginalInteraction(interaction.application_id, interaction.token, {
        content: 'Không thể tạo issue cho repo này. Hãy kiểm tra quyền PAT, repo hoặc Issues setting.',
        components: []
      });

      await logEvent(env, {
        name: 'issue_creation_failed',
        guildId: pending.guildId,
        channelId: pending.channelId,
        userId: pending.userId,
        repo: pending.repo,
        status: err.message
      });
    }
  }
}
