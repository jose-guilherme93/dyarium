// Package mcpserver exposes the Dyarium project diary to AI agents through the
// Model Context Protocol (Streamable HTTP). The server has a single tool: an
// agent records the summary of a finished unit of work and the server decides
// where and how it is written.
package mcpserver

import (
	"log/slog"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/joseti/dyarium/internal/store"
)

// instructions is shown to the agent during initialization. Prose in pt-BR:
// the owner reads these summaries in the diary. Trabalho numa pasta entra por
// session_open e session_close; trabalho sem pasta continua em
// record_project_summary.
const instructions = `Este e o diario central de projetos do dono. Quando voce trabalha numa pasta de projeto, chame session_open no inicio com o caminho absoluto da pasta e session_close no fim com o resumo, os itens e os commits do que foi feito. O session_open devolve na primeira linha o id da sessao: use esse id no session_close quando o cliente nao envia o proprio, e chamar de novo nao duplica nada. Trabalho que nao vem de uma pasta (uma entrega, uma conversa, outro cliente) continua em record_project_summary, com o nome do projeto. O resumo deve ser objetivo e abrir pelos numeros e versoes que importam: ganho de performance, bugs corrigidos, versao da aplicacao, versao do agente, quando existirem. O servidor guarda um registro por projeto no caderno Projetos; chamadas repetidas com o mesmo conteudo nao duplicam. Nao peca confirmacao ao dono antes de registrar; registre e siga. O proprio servidor decide se mostra o resumo conciso ou completo conforme a preferencia do projeto.`

const (
	toolName = "record_project_summary"
	// hostHeader carries the computer name that appears in the session block.
	// It is provenance only: the value is sanitized and never trusted as a path
	// or identity.
	hostHeader = "X-Dyarium-Host"
)

const toolDescription = `Registra no diario do dono o trabalho concluido em um projeto. Use depois de terminar uma tarefa, commit ou entrega relevante, sem pedir confirmacao. Informe o nome do projeto, um resumo curto e objetivo e os itens estruturados. O resumo deve abrir pelos numeros e versoes que importam (performance, bugs corrigidos, versao da aplicacao, versao do agente). O servidor guarda o projeto no caderno Projetos, anexa um bloco de sessao e decide o nivel de detalhe (conciso ou completo) conforme a preferencia do projeto; nao e possivel escolher o nivel pela chamada. Um mesmo registro enviado de novo nao duplica.`

const sessionOpenDescription = `Abre a sessao de trabalho numa pasta de projeto. Chame no inicio do trabalho, com o caminho absoluto. O servidor guarda uma entrada por (maquina, caminho) e uma nota por sessao; chamar de novo com a mesma sessao so atualiza e mantem a nota recente. O resultado comeca com o id da sessao e segue com o historico recente da pasta: guarde esse id para o session_close quando o cliente nao envia o proprio. Nao peca confirmacao ao dono.`

const sessionCloseDescription = `Fecha a sessao de trabalho numa pasta de projeto com o resumo, os itens e os commits do que foi feito. Chame ao terminar, sem pedir confirmacao. Informe o session id devolvido pelo session_open quando o cliente nao envia o proprio. A nota da sessao e selada com o estado fechado e o mesmo conteudo legivel de record_project_summary. Um cliente que so reporta no fim pode chamar direto com o directory e sem session_open; sem sessao aberta e sem directory a chamada falha.`

// service holds the dependencies of the tool handlers.
type service struct {
	store  *store.Store
	logger *slog.Logger
}

// New builds the Streamable HTTP handler of the MCP server. The handler is
// stateless and meant to be mounted behind the API authentication.
func New(st *store.Store, logger *slog.Logger, version string) http.Handler {
	srv := newServer(st, logger, version)
	return mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return srv },
		&mcp.StreamableHTTPOptions{Stateless: true},
	)
}

func newServer(st *store.Store, logger *slog.Logger, version string) *mcp.Server {
	if version == "" {
		version = "dev"
	}
	svc := &service{store: st, logger: logger}
	srv := mcp.NewServer(
		&mcp.Implementation{Name: "dyarium", Title: "Dyarium", Version: version},
		&mcp.ServerOptions{Instructions: instructions},
	)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        toolName,
		Description: toolDescription,
	}, svc.recordProjectSummary)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        sessionOpenTool,
		Description: sessionOpenDescription,
	}, svc.sessionOpen)
	mcp.AddTool(srv, &mcp.Tool{
		Name:        sessionCloseTool,
		Description: sessionCloseDescription,
	}, svc.sessionClose)
	return srv
}
