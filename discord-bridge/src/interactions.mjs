// Message context-menu commands: right-click a message sent from the Owlbear
// page -> Apps -> 编辑（Owlbear） / 删除（Owlbear）. Webhook messages cannot be
// edited in the Discord client, so the bot does it for their owner.
// Interactions arrive over HTTP (POST /interactions, when the Interactions
// Endpoint URL is set) or over the Gateway (when it is not).

export const EDIT_COMMAND = "编辑（Owlbear）";
export const DELETE_COMMAND = "删除（Owlbear）";
export const COMMANDS = [
  { type: 3, name: EDIT_COMMAND, contexts: [0] },
  { type: 3, name: DELETE_COMMAND, contexts: [0] },
];
const EDIT_MODAL = "owlbear-edit";
const EPHEMERAL = 64;

const PING = 1;
const APPLICATION_COMMAND = 2;
const MODAL_SUBMIT = 5;
const MESSAGE_COMMAND = 3;

function hexToBytes(hex) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex || "")) return null;
  return Uint8Array.from(hex.match(/../g), (byte) => parseInt(byte, 16));
}

/** Checks Discord's Ed25519 signature over timestamp + raw body */
export async function verifyInteraction(body, signature, timestamp, publicKey) {
  const sig = hexToBytes(signature);
  const key = hexToBytes(publicKey);
  if (!sig || !key || !timestamp) return false;
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

export function ephemeral(content) {
  return { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } };
}

/** Finds a text input's value in a modal submit (classic rows or the newer label components) */
export function modalValue(components, customId) {
  for (const component of components || []) {
    if (component.custom_id === customId && "value" in component) return component.value;
    const nested = modalValue([...(component.components || []), ...(component.component ? [component.component] : [])], customId);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

/**
 * @param interaction Discord interaction object
 * @param ops {{ ownerOf(id): string|null, edit(channelId, messageId, content): Promise, remove(channelId, messageId): Promise }}
 * @returns interaction response object
 */
export async function handleInteraction(interaction, ops) {
  if (interaction.type === PING) return { type: 1 };
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const checkOwner = (messageId) => {
    const owner = ops.ownerOf(messageId);
    if (!owner) return ephemeral("这条消息不是从 Owlbear 聊天窗发出的，这里改不了。Tupperbox 发的消息请用 📝 编辑。");
    if (owner !== userId) return ephemeral("只能修改你自己从 Owlbear 发出的消息。");
    return null;
  };

  try {
    if (interaction.type === APPLICATION_COMMAND && interaction.data?.type === MESSAGE_COMMAND) {
      const messageId = interaction.data.target_id;
      const message = interaction.data.resolved?.messages?.[messageId];
      const channelId = message?.channel_id || interaction.channel_id;
      const denied = checkOwner(messageId);
      if (denied) return denied;

      if (interaction.data.name === EDIT_COMMAND) {
        return {
          type: 9,
          data: {
            custom_id: `${EDIT_MODAL}:${channelId}:${messageId}`,
            title: "编辑消息",
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: "content",
                    label: "消息内容",
                    style: 2,
                    value: (message?.content || "").slice(0, 2000),
                    min_length: 1,
                    max_length: 2000,
                    required: true,
                  },
                ],
              },
            ],
          },
        };
      }
      if (interaction.data.name === DELETE_COMMAND) {
        await ops.remove(channelId, messageId);
        return ephemeral("已删除。");
      }
    }

    if (interaction.type === MODAL_SUBMIT && interaction.data?.custom_id?.startsWith(`${EDIT_MODAL}:`)) {
      const [, channelId, messageId] = interaction.data.custom_id.split(":");
      const denied = checkOwner(messageId);
      if (denied) return denied;
      const content = String(modalValue(interaction.data.components, "content") || "").trim();
      if (!content) return ephemeral("消息不能为空；想删掉请用「删除（Owlbear）」。");
      await ops.edit(channelId, messageId, content);
      return ephemeral("已修改。");
    }
  } catch (e) {
    console.error("interaction failed", e);
    return ephemeral(`出错了：${e.message || e}`);
  }
  return ephemeral("不认识这个操作。");
}
