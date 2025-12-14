# Migração Spotter -> HubSpot: Exportador de Produtos

Este script extrai produtos da API v3 do Exact Spotter e gera um arquivo CSV compatível com a importação de produtos do HubSpot.

## Configuração

### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto ou exporte as seguintes variáveis de ambiente:

- `SPOTTER_TOKEN_EXACT`: **Obrigatório**. O seu token de acesso para a API do Exact Spotter.
- `SPOTTER_BASE_URL`: Opcional. A URL base da API do Spotter. O padrão é `https://api.exactspotter.com`.

Exemplo de arquivo `.env`:

```
SPOTTER_TOKEN_EXACT="seu-token-aqui"
```

## Como Rodar o Script

### Pré-requisitos

- Node.js (versão 18 ou superior)
- `ts-node` e `typescript` instalados como dependências de desenvolvimento.

Se as dependências não estiverem instaladas, execute:
```bash
npm install --save-dev typescript ts-node
# ou
pnpm add -D typescript ts-node
```

### Execução

Para executar o script, utilize o seguinte comando no terminal:

```bash
node --loader ts-node/esm scripts/export-spotter-products.ts
```
É recomendado o uso de um pacote como `dotenv` para carregar as variáveis de ambiente do arquivo `.env` automaticamente. Se não, você pode prefixar o comando:

```bash
SPOTTER_TOKEN_EXACT="seu-token-aqui" node --loader ts-node/esm scripts/export-spotter-products.ts
```

## Saída

O script irá gerar um arquivo chamado `products_hubspot.csv` na raiz do projeto. Este arquivo conterá os produtos extraídos, formatados para importação no HubSpot com os seguintes cabeçalhos:

- `Nome <PRODUCT name>`
- `Price BRL <PRODUCT hs_price_brl>`
- `ID do Produto no Spotter`
