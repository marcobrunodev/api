import {
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  Guild,
  User,
  GuildMember,
  VoiceChannel,
} from "discord.js";
import { ButtonActions } from "../enums/ButtonActions";
import { customAlphabet } from 'nanoid';
import { HasuraService } from "../../hasura/hasura.service";
import { DiscordBotService } from "../discord-bot.service";
import { getDuelMaps, createVetoSession, getVetoStatusText, formatMapName } from "./duel-veto.helper";

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5);

export interface CreateDuelRoomsOptions {
  bot: DiscordBotService;
  hasura: HasuraService;
  challengerId: string;
  opponentId: string;
  challenger: User;
  opponent: User;
  guild: Guild;
  channel: TextChannel;
  messageId: string;
  /** Canal de voz de origem (se o comando foi executado em um canal de voz) */
  sourceVoiceChannel?: VoiceChannel;
}

export async function createDuelRooms(options: CreateDuelRoomsOptions) {
  const {
    bot,
    hasura,
    challengerId,
    opponentId,
    challenger,
    opponent,
    guild,
    channel,
    messageId,
    sourceVoiceChannel,
  } = options;
  const shortCode = nanoid();

  await guild.channels.fetch();

  const botMember = await guild.members.fetch(bot.client.user.id);

  // Criar categoria específica para este duel
  const category = await guild.channels.create({
    name: `Banana Duel - #${shortCode}`,
    type: ChannelType.GuildCategory,
  });

  // Criar canal de voz para o duel
  const duelVoiceChannel = await guild.channels.create({
    name: 'Duel Voice',
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      {
        id: botMember.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ],
      },
      {
        id: challengerId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      },
      {
        id: opponentId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      },
    ],
  });

  // Configurar permissões para canal picks-bans
  const permissionOverwrites: any[] = [
    {
      id: botMember.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ],
    },
    {
      id: guild.id,
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions
      ],
    },
    {
      id: challengerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions
      ],
    },
    {
      id: opponentId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions
      ],
    },
  ];

  // Criar canal de texto picks-bans
  const picksBans = await guild.channels.create({
    name: 'picks-bans',
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: permissionOverwrites,
  });

  // Atualizar mensagem original mostrando que foi aceito
  const acceptedEmbed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("✅ Duel Accepted!")
    .setDescription(
      `### <@${challengerId}>  ⚔️ VS ⚔️  <@${opponentId}>\n\n` +
      `The duel has been accepted! Get ready to fight!\n\n` +
      `📁 **Category:** ${category.name}\n` +
      `💬 **Chat:** ${picksBans}\n` +
      `🔊 **Voice:** ${duelVoiceChannel}`,
    )
    .setThumbnail(challenger.displayAvatarURL({ size: 256 }))
    .setImage(opponent.displayAvatarURL({ size: 256 }))
    .setFooter({
      text: "BananaServer.xyz Mix",
      iconURL: guild.iconURL() ?? undefined,
    })
    .setTimestamp();

  // Atualizar mensagem original
  const message = await channel.messages.fetch(messageId);
  await message.edit({
    embeds: [acceptedEmbed],
    components: [],
  });

  // Buscar os membros do guild
  const challengerMember = await guild.members.fetch(challengerId);
  const opponentMember = await guild.members.fetch(opponentId);

  // Enviar mensagem de boas-vindas no canal picks-bans
  await picksBans.send({
    embeds: [{
      title: '⚔️ Welcome to the Banana Duel!',
      description: 
        `### <@${challengerId}>  ⚔️ VS ⚔️  <@${opponentId}>\n\n` +
        'Ban maps by clicking the buttons below.\n' +
        'Each player bans **3 maps** alternately.\n' +
        'The last remaining map will be played!\n\n' +
        '**Good luck and have fun!** 🍌',
      color: 0xFFD700,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'From BananaServer.xyz with 🍌',
      }
    }]
  });

  // Buscar mapas de duel e iniciar o veto
  const maps = await getDuelMaps(hasura);
  
  // Criar sessão de veto
  const vetoEmbed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle("🗺️ Map Veto")
    .setDescription(
      `### <@${challengerId}>  ⚔️ VS ⚔️  <@${opponentId}>\n\n` +
      `**Current Turn:** <@${challengerId}>\n` +
      `**Bans Remaining:** 3\n\n` +
      '**Available Maps:**\n' +
      maps.map(m => `🗺️ ${formatMapName(m.name)}`).join('\n') +
      `\n\n<@${challengerId}>, click a map button to ban it!`
    )
    .setFooter({
      text: "From BananaServer.xyz with 🍌",
    })
    .setTimestamp();

  // Criar botões para os mapas
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  
  // Enviar mensagem de veto primeiro para pegar o ID
  const vetoMessage = await picksBans.send({
    embeds: [vetoEmbed],
    components: [] // Componentes serão adicionados depois
  });

  // Criar sessão de veto com o ID da mensagem
  createVetoSession(
    vetoMessage.id,
    picksBans.id,
    category.id,
    guild.id,
    challengerId,
    opponentId,
    maps
  );

  // Agora criar os botões com o ID da mensagem
  for (let i = 0; i < maps.length; i++) {
    const map = maps[i];
    const button = new ButtonBuilder()
      .setCustomId(`${ButtonActions.DuelVetoBan}:${vetoMessage.id}:${map.id}`)
      .setLabel(formatMapName(map.name))
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🗺️');

    currentRow.addComponents(button);

    // Discord permite no máximo 5 botões por row
    if ((i + 1) % 5 === 0 || i === maps.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  // Atualizar mensagem com os botões
  await vetoMessage.edit({
    embeds: [vetoEmbed],
    components: rows
  });

  // Mover jogadores para a sala de áudio do duel ou enviar DM
  await moveOrNotifyPlayers(
    challengerMember,
    opponentMember,
    challenger,
    opponent,
    duelVoiceChannel,
    channel, // canal original onde foi executado o /mix-duel
    picksBans,
    guild
  );

  console.log(`Duel rooms created: ${category.name} for ${challengerId} vs ${opponentId}`);
}

/**
 * Move players to the duel voice channel or send DM with invite
 */
async function moveOrNotifyPlayers(
  challengerMember: GuildMember,
  opponentMember: GuildMember,
  challenger: User,
  opponent: User,
  duelVoiceChannel: VoiceChannel,
  originalChannel: TextChannel, // canal onde foi executado o /mix-duel
  picksBansChannel: TextChannel,
  guild: Guild
) {
  const playersToNotify: GuildMember[] = [];

  // Verificar e mover/notificar challenger
  if (challengerMember.voice.channel) {
    try {
      await challengerMember.voice.setChannel(duelVoiceChannel.id);
      console.log(`Moved ${challengerMember.user.tag} to duel voice channel`);
    } catch (error) {
      console.error(`Failed to move ${challengerMember.user.tag}:`, error);
      playersToNotify.push(challengerMember);
    }
  } else {
    playersToNotify.push(challengerMember);
  }

  // Verificar e mover/notificar opponent
  if (opponentMember.voice.channel) {
    try {
      await opponentMember.voice.setChannel(duelVoiceChannel.id);
      console.log(`Moved ${opponentMember.user.tag} to duel voice channel`);
    } catch (error) {
      console.error(`Failed to move ${opponentMember.user.tag}:`, error);
      playersToNotify.push(opponentMember);
    }
  } else {
    playersToNotify.push(opponentMember);
  }

  // Send notification to players who are not in a voice channel
  if (playersToNotify.length > 0) {
    // Send message in the original channel (where /mix-duel was executed)
    const missingPlayers = playersToNotify.map(p => `<@${p.id}>`).join(' and ');
    await originalChannel.send({
      content: `⚠️ ${missingPlayers} - Join the voice channel to participate in the duel!`,
      embeds: [{
        title: '🔊 Join the Voice Channel',
        description: 
          `### <@${challengerMember.id}>  ⚔️ VS ⚔️  <@${opponentMember.id}>\n\n` +
          `Click the button below to join the duel voice channel.`,
        color: 0x2ecc71, // Green color
        thumbnail: {
          url: challenger.displayAvatarURL({ size: 256 }),
        },
        image: {
          url: opponent.displayAvatarURL({ size: 256 }),
        },
        fields: [
          {
            name: '💬 Text Channel',
            value: `${picksBansChannel}`,
            inline: true
          },
          {
            name: '🔊 Voice Channel',
            value: `${duelVoiceChannel.name}`,
            inline: true
          }
        ],
        footer: {
          text: 'From BananaServer.xyz with 🍌',
        }
      }],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ButtonActions.JoinDuelVoice}:${duelVoiceChannel.id}`)
            .setLabel('🔊 Join Voice Channel')
            .setStyle(ButtonStyle.Success)
        )
      ]
    });

    // Create invite for DM (Link buttons work in DMs)
    let inviteUrl: string;
    try {
      const invite = await duelVoiceChannel.createInvite({
        maxAge: 3600, // 1 hour
        maxUses: 10,
        unique: true,
        reason: 'Duel voice channel invite for DM'
      });
      inviteUrl = invite.url;
    } catch (error) {
      console.error('Failed to create invite:', error);
      inviteUrl = `https://discord.com/channels/${guild.id}/${duelVoiceChannel.id}`;
    }

    // Send DM to each player who is not in the voice channel
    for (const member of playersToNotify) {
      try {
        const otherPlayer = member.id === challengerMember.id ? opponent : challenger;
        
        await member.send({
          embeds: [{
            title: '⚔️ Your Duel is Ready!',
            description: 
              `### <@${challengerMember.id}>  ⚔️ VS ⚔️  <@${opponentMember.id}>\n\n` +
              `You have been challenged to a duel in **${guild.name}**!\n\n` +
              `Join the voice channel to participate.`,
            color: 0x2ecc71, // Green color
            thumbnail: {
              url: member.user.displayAvatarURL({ size: 256 }),
            },
            image: {
              url: otherPlayer.displayAvatarURL({ size: 256 }),
            },
            fields: [
              {
                name: '💬 Text Channel',
                value: `#${picksBansChannel.name}`,
                inline: true
              },
              {
                name: '🔊 Voice Channel',
                value: `${duelVoiceChannel.name}`,
                inline: true
              }
            ],
            footer: {
              text: 'From BananaServer.xyz with 🍌',
            }
          }],
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setLabel('🔊 Join Voice Channel')
                .setStyle(ButtonStyle.Link)
                .setURL(inviteUrl)
            )
          ]
        });
        console.log(`Sent DM to ${member.user.tag} with duel voice channel invite`);
      } catch (error) {
        console.error(`Failed to send DM to ${member.user.tag}:`, error);
      }
    }
  }
}