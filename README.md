# Exportador de Produtos do Exact Spotter para HubSpot

Este repositório fornece um script em TypeScript para exportar produtos do Exact Spotter (API v3) e gerar um CSV pronto para importação de Produtos no HubSpot.

## Pré-requisitos
- Node.js 18+
- Variável de ambiente `SPOTTER_TOKEN_EXACT` com o token de acesso do Exact Spotter.
- (Opcional) `SPOTTER_BASE_URL` caso queira usar uma URL base diferente de `https://api.exactspotter.com`.

## Como rodar
1. Instale as dependências:
   ```bash
   npm install
   ```
2. Exporte o token antes de executar:
   ```bash
   export SPOTTER_TOKEN_EXACT="seu_token_aqui"
   # Opcional: export SPOTTER_BASE_URL="https://api.exactspotter.com"
   ```
3. Execute o exportador:
   ```bash
   npm run export:products
   ```

## Saída
- O script gera o arquivo `products_hubspot.csv` na raiz do projeto com os headers:
  - `Nome`
  - `Price BRL`
  - `ID do Produto no Spotter`
- Cada linha contém a descrição do produto, o preço (com ponto decimal) e o ID do produto no Spotter.
