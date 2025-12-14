# migracao-spotter-hubspot

Este repositório contém ferramentas para migrar dados do Exact Spotter para o HubSpot.

## Scripts de Migração

### Exportador de Produtos

Este script extrai produtos da API v3 do Exact Spotter e gera um arquivo CSV compatível com a importação de produtos do HubSpot.

#### Configuração

##### Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto ou exporte as seguintes variáveis de ambiente:

- `SPOTTER_TOKEN_EXACT`: **Obrigatório**. O seu token de acesso para a API do Exact Spotter.
- `SPOTTER_BASE_URL`: Opcional. A URL base da API do Spotter. O padrão é `https://api.exactspotter.com`.

Exemplo de arquivo `.env`:

```
SPOTTER_TOKEN_EXACT="seu-token-aqui"
```

#### Como Rodar o Script

##### Pré-requisitos

- Node.js (versão 18 ou superior)
- `ts-node` e `typescript` (já configurados no `package.json`).

Execute `pnpm install` para garantir que todas as dependências estejam instaladas.

##### Execução

Para executar o script, utilize o seguinte comando no terminal:

```bash
pnpm ts-node scripts/export-spotter-products.ts
```

Se você não estiver usando um arquivo `.env` com `dotenv`, precisará prefixar o comando com a variável de ambiente:

```bash
SPOTTER_TOKEN_EXACT="seu-token-aqui" pnpm ts-node scripts/export-spotter-products.ts
```

#### Saída

O script irá gerar um arquivo chamado `products_hubspot.csv` na raiz do projeto.

---

## Aplicação Web (Next.js)

Este repositório também contém uma aplicação web mínima em Next.js, usada para verificar o status da implantação e resolver problemas como o do favicon.
