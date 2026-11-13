# Colocar o Gantt de Produção a correr no servidor

Esta app é só uma página (sem login, sem base de dados própria) que lê a programação de lotes
do Orgatex. Vive dentro do mesmo clone do Portal (`C:\portal-kaizen`), por isso **não precisa de
tarefa agendada nova**: a tarefa `PortalKaizenUpdate` que já existe (git pull de 5 em 5 minutos)
atualiza este código ao mesmo tempo que atualiza o Portal. Só falta criar o serviço do Windows,
**uma vez**.

## 1. Instalar as dependências (uma vez)

Numa PowerShell, dentro da pasta onde o Portal já está clonado:
```powershell
cd C:\portal-kaizen\gantt-producao
npm install --omit=dev
```

## 2. Testar manualmente antes de o tornar permanente

```powershell
cd C:\portal-kaizen\gantt-producao
node server.js
```
Deve aparecer `gantt-producao a correr em http://0.0.0.0:5051`. Abrir `http://localhost:5051` no
próprio servidor para confirmar que a página carrega. Depois `Ctrl+C` para parar (foi só um teste).

## 3. Ligação ao Orgatex

Usa as **mesmas credenciais** que já estão em `C:\LabDataAppSecrets\.env` (as que o Lab Data usa
para a Análise de Lotes Macro): `ORGATEX_INTEG_SERVER`, `ORGATEX_INTEG_DB`, `ORGATEX_INTEG_UID`,
`ORGATEX_INTEG_PWD`. Não é preciso copiar nem duplicar nada — se o Lab Data já lê o Orgatex, este
Gantt lê das mesmas. Só se quiseres usar outra pasta de segredos: variável de ambiente
`GANTT_SECRETS_DIR`.

## 4. Abrir a porta na firewall

```powershell
netsh advfirewall firewall add rule name="Gantt Producao" dir=in action=allow protocol=TCP localport=5051
```

## 5. Arranque automático: serviço do Windows (NSSM)

Instalar o NSSM uma vez por servidor (saltar se já estiver instalado, por exemplo para o Lab Data):
```powershell
winget install NSSM.NSSM
```

Numa PowerShell de **Administrador**, registar o serviço:
```powershell
$node = (Get-Command node).Source
nssm install GanttProducao $node "C:\portal-kaizen\gantt-producao\server.js"
nssm set GanttProducao AppDirectory "C:\portal-kaizen\gantt-producao"
nssm set GanttProducao AppStdout "C:\portal-kaizen\gantt-producao\logs\app.log"
nssm set GanttProducao AppStderr "C:\portal-kaizen\gantt-producao\logs\app.log"
nssm set GanttProducao AppRotateFiles 1
nssm set GanttProducao Start SERVICE_AUTO_START
New-Item -ItemType Directory -Force "C:\portal-kaizen\gantt-producao\logs" | Out-Null
nssm start GanttProducao
```

Confirmar:
```powershell
Get-Service GanttProducao
Get-Content C:\portal-kaizen\gantt-producao\logs\app.log -Tail 30
```

## 6. Dia a dia

- **Atualização de código:** automática, pela tarefa `PortalKaizenUpdate` (git pull a cada 5 min).
  Só é preciso reiniciar o serviço depois de um `git pull` que mude ficheiros do Gantt — o `node`
  não recarrega sozinho. Enquanto não houver um atualizador próprio (como o do Lab Data), reiniciar
  à mão quando souberes que saiu uma alteração:
  ```powershell
  Restart-Service GanttProducao
  ```
- **Dados:** ficam em `C:\portal-kaizen\gantt-producao\data\gantt-orgatex.json` (cache da última
  leitura do Orgatex — se o Orgatex falhar, a página mostra os últimos dados guardados).
- **Acesso:** `http://<ip-do-servidor>:5051` a partir de qualquer PC da rede interna.
