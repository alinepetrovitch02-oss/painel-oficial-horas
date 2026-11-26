# Painel Oficial de Horas

Projeto estático com endpoint serverless para consulta das abas **November Leaderboard** (dados e posição principal) e **10-Day Bonus (Nov 25 - Dec 4)** (ranking do Day Bônus, posição simples 1, 2, 3… sem somar linhas). Se os nomes das abas mudarem, ajuste `NOVEMBER_SHEET` e `BONUS_SHEET` no topo de `api/consulta.js`.

## Estrutura

- `index.html`: interface do painel.
- `api/consulta.js`: consulta os dados atuais da planilha oficial, sem cache, e preserva o número da linha de cada registro como sua posição na planilha.
- `package.json`: metadados mínimos do projeto.
- `vercel.json`: configuração básica da Vercel.

## Configuração na Vercel

A leitura da planilha usa o endpoint público GViz. Não é necessária a variável `GOOGLE_DRIVE_API_KEY` para este painel. A planilha precisa permitir leitura pública pelo endpoint utilizado.

## Publicação

Conecte este repositório à Vercel. Cada commit na branch configurada dispara uma nova implantação.
