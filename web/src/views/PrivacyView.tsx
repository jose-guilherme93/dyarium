import "./admin.css";

/**
 * Privacidade para quem usa o cofre.
 *
 * Fala so do que o produto NAO faz com os dados da pessoa. O painel do dono,
 * o cadastro de contas e as contagens ficam fora desta pagina de proposito:
 * sao assunto de administracao, nao do usuario.
 */
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
            As notas, áudios e imagens ficam cifrados no seu próprio Google Drive.
            Nada disso é copiado para um servidor do Dyarium.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">O que não sai do aparelho</p>
          <p className="privacy-text">
            O texto das notas, o áudio original e a transcrição. O acesso ao Google
            fica na memória desta aba e some quando ela fecha.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">Conta Google</p>
          <p className="privacy-text">
            Ao entrar com Google, o e-mail da conta identifica a sua sessão no
            Dyarium. Não usamos para publicidade nem repassamos a terceiros.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">O que não coletamos</p>
          <p className="privacy-text">
            Conteúdo de nota, áudio, transcrição, contatos, localização, histórico
            de navegação, cookies de publicidade. Nenhum endereço IP é guardado.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">Diagnóstico</p>
          <p className="privacy-text">
            Se estiver ligado, o app envia erro técnico e versão, sem nota e sem
            conteúdo. Você desliga em Configurações.
          </p>
        </section>

        <section className="privacy-section">
          <p className="privacy-label">Exclusão</p>
          <p className="privacy-text">
            Sair da conta apaga o cache deste navegador. Os arquivos do Drive são
            seus: apagar de lá remove de todos os aparelhos.
          </p>
        </section>
      </div>
    </main>
  );
}

export default PrivacyView;
