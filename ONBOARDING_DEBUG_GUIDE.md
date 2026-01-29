# Guia de Debug - Sistema de Onboarding dos Canais

## 📋 Resumo das Mudanças

### Arquivos Modificados/Criados:
1. ✅ `src/discord-bot/helpers/channel-onboarding.helper.ts` (NOVO)
2. ✅ `src/discord-bot/interactions/Init.ts` (MODIFICADO)
3. ✅ `src/discord-bot/interactions/ScheduleMix.ts` (MODIFICADO)
4. ✅ `src/discord-bot/interactions/MapVeto.ts` (MODIFICADO)

---

## 🔍 Como Verificar se Está Funcionando

### Passo 1: Reiniciar o Bot

```bash
cd /Users/marcobrunodev/code/api
yarn start:dev
```

**Procure por erros de compilação TypeScript** nos logs iniciais.

---

### Passo 2: Testar Comando `/init`

#### Comportamento Esperado:
1. Execute `/init` no Discord
2. Deve criar o canal **`banana-info`** dentro da categoria `🍌 BananaServer.xyz Mix`
3. Dentro do canal `banana-info` devem aparecer **3 mensagens** com embeds:

**Mensagem 1 - Categoria:**
```
🍌 BananaServer.xyz Mix Category
Main category for all mix-related channels
📋 How to Use
1. Contains the Queue Mix voice channel
2. Contains the AFK channel
3. All mix sessions will be created below this category
```

**Mensagem 2 - Queue Mix:**
```
🍌 Queue Mix Voice Channel
Join this channel to queue for competitive mixes
📋 How to Use
1. Join this channel and wait for 10 players
2. Once 10 players are in the queue, any player can use `/mix` to start
3. Players will be automatically moved to the mix channels
```

**Mensagem 3 - AFK:**
```
💤 AFK Channel
Channel for AFK/inactive players
📋 How to Use
1. Players who don't ready up in time will be moved here
2. You can manually move to this channel if you need to go AFK
3. AFK players receive a penalty and are moved to the end of the queue
```

#### Logs Esperados no Console:
```
[CHANNEL ONBOARDING] Sending onboarding for type: banana_mix_category to channel: banana-info
[CHANNEL ONBOARDING] ✅ Successfully sent onboarding message (ID: ...)
[CHANNEL ONBOARDING] Sending onboarding for type: queue_mix to channel: banana-info
[CHANNEL ONBOARDING] ✅ Successfully sent onboarding message (ID: ...)
[CHANNEL ONBOARDING] Sending onboarding for type: afk to channel: banana-info
[CHANNEL ONBOARDING] ✅ Successfully sent onboarding message (ID: ...)
```

#### Arquivo Responsável:
- **Arquivo:** `src/discord-bot/interactions/Init.ts`
- **Linhas:** 128-173

#### ⚠️ IMPORTANTE:
- As mensagens **SÓ SÃO ENVIADAS** se o canal `banana-info` foi **recém-criado**
- Se o canal já existe, as mensagens **NÃO serão enviadas novamente**
- Para testar novamente: **delete o canal `banana-info` manualmente** e execute `/init` de novo

---

### Passo 3: Testar Comando `/mix`

#### Comportamento Esperado:
1. Junte 10 players no canal `🍌 Queue Mix`
2. Execute `/mix`
3. No canal **`picks-bans`** deve aparecer **1 mensagem de onboarding** ANTES da mensagem "Welcome to the Banana Mix!"

**Mensagem Esperada:**
```
🎮 Welcome to Your Mix Session!
Your mix session Banana Mix - #XXXXX has been created!

Here's a quick guide to the channels you'll use:

🔊 Mix Voice
All players start here. Complete the ready check and vote for captains.

💬 picks-bans
This channel! Used for ready check → captain voting → team selection → map veto

🔊 Team Channels
After team selection, each team gets their own voice channel for tactics

📊 scoreboard
Created after map veto. Shows live match stats and updates each round
```

#### Logs Esperados no Console:
```
[MIX SESSION ONBOARDING] Sending onboarding for mix XXXXX to channel: picks-bans
[MIX SESSION ONBOARDING] ✅ Successfully sent onboarding message (ID: ...)
```

#### Arquivo Responsável:
- **Arquivo:** `src/discord-bot/interactions/ScheduleMix.ts`
- **Linha:** 201

---

### Passo 4: Testar Criação do Canal Scoreboard

#### Comportamento Esperado:
1. Continue o fluxo do mix: ready check → vote captains → pick teams → ban maps
2. Após o veto de mapas, o canal **`scoreboard`** é criado
3. Deve aparecer **1 mensagem de onboarding** ANTES do scoreboard inicial

**Mensagem Esperada:**
```
📊 Scoreboard Channel
Live match statistics and scoreboard

📋 How to Use
1. Displays real-time match statistics
2. Updated automatically after each round
3. Shows team scores, player stats, and round history
4. Read-only channel (only bot can send messages)

ℹ️ Additional Info
Match ID: `...` | Map: de_mirage
```

#### Logs Esperados no Console:
```
[CHANNEL ONBOARDING] Sending onboarding for type: scoreboard to channel: scoreboard
[CHANNEL ONBOARDING] ✅ Successfully sent onboarding message (ID: ...)
```

#### Arquivo Responsável:
- **Arquivo:** `src/discord-bot/interactions/MapVeto.ts`
- **Linhas:** 471-475

---

## 🐛 Troubleshooting

### Problema: As mensagens não aparecem

#### Verificação 1: Bot foi reiniciado?
```bash
# Pare o bot (Ctrl+C) e reinicie
cd /Users/marcobrunodev/code/api
yarn start:dev
```

#### Verificação 2: Erros de compilação TypeScript?
```bash
cd /Users/marcobrunodev/code/api
yarn build
```

Se houver erros, eles aparecerão aqui.

#### Verificação 3: Imports estão corretos?
```bash
cd /Users/marcobrunodev/code/api
grep -n "import.*channel-onboarding" src/discord-bot/interactions/*.ts
```

Deve retornar:
```
Init.ts:10:import { sendChannelOnboarding, OnboardingChannelType } from "../helpers/channel-onboarding.helper";
ScheduleMix.ts:14:import { sendMixSessionOnboarding } from "../helpers/channel-onboarding.helper";
MapVeto.ts:6:import { sendChannelOnboarding, OnboardingChannelType } from "../helpers/channel-onboarding.helper";
```

#### Verificação 4: Logs de debug aparecem?
Procure nos logs do bot por:
- `[CHANNEL ONBOARDING]`
- `[MIX SESSION ONBOARDING]`

Se **NÃO aparecerem**, significa que:
- O código não está sendo executado (bot não foi reiniciado)
- Há um erro antes de chegar nessa linha

Se aparecer **`❌ Failed to send`**, significa:
- Permissões do bot no Discord estão incorretas
- Canal não é do tipo TextChannel

---

## 📝 Código de Debug Adicional (Opcional)

### Adicionar log em Init.ts:

Adicione ANTES da linha 157 em `src/discord-bot/interactions/Init.ts`:

```typescript
console.log('🐛 DEBUG Init.ts - sendOnboarding:', sendOnboarding);
console.log('🐛 DEBUG Init.ts - infoChannel exists:', !!infoChannel);
console.log('🐛 DEBUG Init.ts - infoChannel has send:', infoChannel && 'send' in infoChannel);
```

### Adicionar log em ScheduleMix.ts:

Adicione ANTES da linha 201 em `src/discord-bot/interactions/ScheduleMix.ts`:

```typescript
console.log('🐛 DEBUG ScheduleMix.ts - shortCode:', shortCode);
console.log('🐛 DEBUG ScheduleMix.ts - category.name:', category.name);
console.log('🐛 DEBUG ScheduleMix.ts - picksBans channel:', picksBans.name);
```

### Adicionar log em MapVeto.ts:

Adicione ANTES da linha 471 em `src/discord-bot/interactions/MapVeto.ts`:

```typescript
console.log('🐛 DEBUG MapVeto.ts - matchId:', matchId);
console.log('🐛 DEBUG MapVeto.ts - mapName:', mapName);
console.log('🐛 DEBUG MapVeto.ts - logChannel:', logChannel.name);
```

---

## 📊 Status dos Tipos de Canal

| Tipo de Canal | Enum | Onde é criado | Onboarding aplicado? |
|---------------|------|---------------|---------------------|
| 🍌 Categoria Principal | `BANANA_MIX_CATEGORY` | `/init` | ✅ Sim (em banana-info) |
| 🍌 Queue Mix | `QUEUE_MIX` | `/init` | ✅ Sim (em banana-info) |
| 💤 AFK | `AFK` | `/init` | ✅ Sim (em banana-info) |
| 🎮 Mix Category | `MIX_CATEGORY` | `/mix` | ✅ Sim (inline no picks-bans) |
| 🔊 Mix Voice | `MIX_VOICE` | `/mix` | ✅ Sim (inline no picks-bans) |
| 💬 picks-bans | `PICKS_BANS` | `/mix` | ✅ Sim (mensagem completa da sessão) |
| 📊 scoreboard | `SCOREBOARD` | Após map veto | ✅ Sim (mensagem própria) |

---

## 🎯 Próximos Passos

Se tudo estiver funcionando, você verá:
1. Canal `banana-info` com 3 mensagens de onboarding após `/init`
2. Mensagem de onboarding no canal `picks-bans` após `/mix`
3. Mensagem de onboarding no canal `scoreboard` após map veto

Se algo não funcionar, **procure pelos logs** e verifique se:
- Bot foi reiniciado
- Não há erros de compilação
- Logs de debug aparecem no console
