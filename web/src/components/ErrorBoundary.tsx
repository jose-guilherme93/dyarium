import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// ErrorBoundary keeps a rendering error from blanking the whole page.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Erro na interface:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="view">
          <h1>Algo deu errado</h1>
          <p className="error">{this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
