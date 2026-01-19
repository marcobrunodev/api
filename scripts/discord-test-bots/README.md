# Discord Test Bots

Scripts para testar funcionalidades do Banana Mix com múltiplos bots simulados.

## 📋 Pré-requisitos

1. **Criar aplicações de bots no Discord Developer Portal**
   - Acesse: https://discord.com/developers/applications
   - Crie até 10 aplicações bot (ou quantas precisar)
   - Para cada bot:
     - Vá em "Bot" → "Reset Token" → copie o token
     - Em "Privileged Gateway Intents", ative:
       - ✅ PRESENCE INTENT
       - ✅ SERVER MEMBERS INTENT
       - ✅ MESSAGE CONTENT INTENT
     - Em "OAuth2" → "URL Generator":
       - Selecione `bot` em SCOPES
       - Selecione estas permissões em BOT PERMISSIONS:
         - ✅ Connect (Voice)
         - ✅ Speak (Voice)
         - ✅ Read Messages/View Channels
       - Copie a URL gerada e use para adicionar o bot ao servidor

2. **Instalar dependências**
   ```bash
   cd api/scripts/discord-test-bots
   npm install discord.js @discordjs/voice
   ```

## 🚀 Como Usar

### 1. Configurar Tokens dos Bots

Crie um arquivo `.env` nesta pasta ou exporte as variáveis:

```bash
export BOT_TOKEN_1="seu_token_bot_1"
export BOT_TOKEN_2="seu_token_bot_2"
export BOT_TOKEN_3="seu_token_bot_3"
# ... até BOT_TOKEN_25 se necessário
```

Ou crie um arquivo `.env`:
```
BOT_TOKEN_1=seu_token_bot_1
BOT_TOKEN_2=seu_token_bot_2
BOT_TOKEN_3=seu_token_bot_3
```

### 2. Obter IDs Necessários

#### Guild ID (ID do Servidor):
- No Discord, ative o Modo Desenvolvedor: Settings → Advanced → Developer Mode
- Clique com botão direito no servidor → "Copy Server ID"

#### Voice Channel ID (ID do Canal de Voz):
- Clique com botão direito no canal de voz → "Copy Channel ID"

### 3. Executar os Bots

```bash
# Sintaxe básica
node test-bots.js <guild_id> <voice_channel_id> [número_de_bots]

# Exemplo: conectar 10 bots
node test-bots.js 123456789012345678 987654321098765432 10

# Exemplo: conectar todos os bots disponíveis (baseado nos tokens)
node test-bots.js 123456789012345678 987654321098765432
```

### 4. Desconectar os Bots

Pressione `Ctrl+C` para desconectar todos os bots.

## 🧪 Testando o Banana Mix

### Fluxo Completo de Teste

1. **Iniciar os bots de teste**
   ```bash
   node test-bots.js <guild_id> <voice_channel_id> 10
   ```

2. **Entre em um canal de voz com sua conta**

3. **Execute o comando `/mix` no Discord**
   - Os bots serão movidos para o canal "Mix Voice" automaticamente
   - A votação de capitães será iniciada

4. **Simular votos dos bots**
   - Use o comando `/test-vote` no Discord:
   ```
   /test-vote message_id:<id_da_mensagem> user_id:<id_do_bot> fruit:🍌
   ```

   **Como pegar os IDs:**
   - **Message ID**: Clique com botão direito na mensagem de votação → "Copy Message ID"
   - **User ID**: Clique com botão direito no bot → "Copy User ID"
   - **Fruit**: Use a mesma emoji mostrada na votação (🍎, 🍊, 🍋, 🍌, etc.)

   **Exemplo completo:**
   ```
   /test-vote message_id:1234567890 user_id:9876543210 fruit:🍌
   /test-vote message_id:1234567890 user_id:1111111111 fruit:🍎
   /test-vote message_id:1234567890 user_id:2222222222 fruit:🍊
   ```

5. **Testar a limpeza automática**
   - Desconecte todos os bots do canal de voz (Ctrl+C no terminal)
   - A categoria "Banana Mix" e todos os canais devem ser deletados automaticamente

## 📝 Comandos Disponíveis

### `/mix`
Cria uma sessão de Banana Mix (comando principal do projeto).

### `/test-vote` (APENAS PARA TESTES)
Simula um voto de capitão.

**Parâmetros:**
- `message_id` - ID da mensagem de votação
- `user_id` - ID do usuário/bot que está votando
- `fruit` - Emoji da fruta para votar

## ⚠️ Notas Importantes

1. **Limite de Bots**: O Discord pode ter rate limits. Recomenda-se adicionar no máximo 10 bots por vez.

2. **Modo Desenvolvedor**: Certifique-se de ativar o Developer Mode no Discord para copiar IDs.

3. **Permissões**: Os bots precisam ter permissões para:
   - Conectar em canais de voz
   - Ver canais
   - Ler mensagens

4. **Comando de Teste em Produção**: O comando `/test-vote` deve ser REMOVIDO ou DESABILITADO em produção, pois permite manipular votações.

5. **Tokens Seguros**: NUNCA commite os tokens dos bots no Git. Use `.env` e adicione ao `.gitignore`.

## 🐛 Troubleshooting

### "No bot tokens found!"
- Verifique se as variáveis de ambiente `BOT_TOKEN_X` estão definidas
- Se usar `.env`, execute: `source .env` antes de rodar o script

### "Channel X is not a voice channel"
- Verifique se o ID do canal está correto
- Certifique-se de que é um canal de VOZ, não de texto

### Bots não aparecem no canal
- Verifique se os bots foram adicionados ao servidor
- Confirme as permissões de voz dos bots
- Verifique os logs no console para erros

### Rate limiting
- Se receber erros de rate limit, adicione delay entre os bots
- O script já tem um delay de 1 segundo entre cada bot

## 📚 Estrutura do Código

```
api/scripts/discord-test-bots/
├── README.md          # Este arquivo
├── test-bots.js       # Script principal dos bots
├── package.json       # Dependências (criar se necessário)
└── .env               # Tokens dos bots (criar manualmente)
```

## 🔗 Links Úteis

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord.js Documentation](https://discord.js.org/)
- [Discord Voice Documentation](https://discordjs.guide/voice/)
