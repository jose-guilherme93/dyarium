import "./admin.css";

export function PrivacyView() {
  return (
    <main className="privacy-page">
      <div className="privacy-column">
        <a className="privacy-back" href="/">
          voltar
        </a>
        <h1 className="privacy-title">Privacidade</h1>

        <section className="privacy-section">
          <p className="privacy-label">No seu Drive</p>
          <p className="privacy-text">
            As notas, áudios e imagens ficam cifrados no Drive de quem usa; o painel do dono não abre esse conteúdo.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">No painel do dono</p>
          <p className="privacy-text">
            Ao entrar com Google, o e-mail da conta é registrado; contagem anônima de uso (navegador, versão, quantidade e tamanho das notas) e erros técnicos, se o diagnóstico estiver ligado.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">O que não sai do aparelho</p>
          <p className="privacy-text">
            Conteúdo das notas, áudio, transcrição, token de acesso; nenhum endereço IP é guardado no painel.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">Por quanto tempo</p>
          <p className="privacy-text">
            Eventos de uso por 180 dias; a conta até pedir exclusão (o dono remove pelo /admin).
          </p>
        </section>
      </div>
    </main>
  );
}

export default PrivacyView;
