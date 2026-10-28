import type { GraphNode } from "../types";

/** Icone padrao de cada tipo de bola. */
export const KIND_ICON: Record<string, string> = {
  person: "person",
  place: "home",
  theme: "hash",
  decision: "check",
  note: "document",
  user: "person",
};

/**
 * Lista de icones monocromaticos que o dono pode escolher para uma bola.
 * O servidor valida as mesmas chaves em internal/store/icons.go.
 */
export const GRAPH_ICONS: { key: string; label: string }[] = [
  { key: "person", label: "Pessoa" },
  { key: "home", label: "Casa" },
  { key: "hash", label: "Tema" },
  { key: "check", label: "Feito" },
  { key: "heart", label: "Afeto" },
  { key: "star", label: "Destaque" },
  { key: "book", label: "Leitura" },
  { key: "briefcase", label: "Trabalho" },
  { key: "music", label: "Música" },
  { key: "health", label: "Saúde" },
  { key: "money", label: "Dinheiro" },
  { key: "food", label: "Comida" },
  { key: "car", label: "Carro" },
  { key: "plane", label: "Viagem" },
  { key: "tree", label: "Natureza" },
  { key: "sun", label: "Dia" },
  { key: "moon", label: "Noite" },
  { key: "flag", label: "Marco" },
  { key: "globe", label: "Mundo" },
  { key: "camera", label: "Foto" },
  { key: "document", label: "Nota" },
];

const ICON_KEYS = new Set(GRAPH_ICONS.map((icon) => icon.key));

/** Chave efetiva: o icone escolhido vence; vazio cai no icone do tipo. */
export function iconKeyFor(kind: GraphNode["kind"], icon?: string): string {
  if (icon && ICON_KEYS.has(icon)) return icon;
  return KIND_ICON[kind] ?? "person";
}

/**
 * Desenha um icone monocromatico numa caixa 24x24 centrada em (cx, cy). Os
 * tracos usam a cor pedida; o cliente nunca recebe bitmap do servidor.
 */
export function drawGraphIcon(
  ctx: CanvasRenderingContext2D,
  key: string,
  cx: number,
  cy: number,
  size: number,
  color: string,
): void {
  if (size < 6) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 24, size / 24);
  // O desenho usa uma caixa 24x24; recuar meia caixa poe o centro do icone no
  // centro da bola.
  ctx.translate(-12, -12);
  ctx.strokeStyle = color;
  ctx.globalAlpha *= 0.92;
  ctx.lineWidth = 2.8;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (key) {
    case "home": {
      ctx.beginPath();
      ctx.moveTo(4.4, 11.4);
      ctx.lineTo(12, 4.6);
      ctx.lineTo(19.6, 11.4);
      ctx.moveTo(6.6, 10.2);
      ctx.lineTo(6.6, 19.4);
      ctx.lineTo(17.4, 19.4);
      ctx.lineTo(17.4, 10.2);
      ctx.moveTo(10.3, 19.4);
      ctx.lineTo(10.3, 14.6);
      ctx.lineTo(13.7, 14.6);
      ctx.lineTo(13.7, 19.4);
      ctx.stroke();
      break;
    }
    case "hash": {
      ctx.beginPath();
      ctx.moveTo(9.6, 4.8);
      ctx.lineTo(8.2, 19.2);
      ctx.moveTo(15.8, 4.8);
      ctx.lineTo(14.4, 19.2);
      ctx.moveTo(5.2, 9.5);
      ctx.lineTo(18.8, 9.5);
      ctx.moveTo(4.8, 14.5);
      ctx.lineTo(18.4, 14.5);
      ctx.stroke();
      break;
    }
    case "check": {
      ctx.beginPath();
      ctx.moveTo(5.4, 12.4);
      ctx.lineTo(10, 17);
      ctx.lineTo(18.6, 7.4);
      ctx.stroke();
      break;
    }
    case "heart": {
      ctx.beginPath();
      ctx.moveTo(12, 19.8);
      ctx.bezierCurveTo(4.2, 14.6, 4, 8.4, 7.8, 6.4);
      ctx.bezierCurveTo(10, 5.4, 12, 7.4, 12, 8.8);
      ctx.bezierCurveTo(12, 7.4, 14, 5.4, 16.2, 6.4);
      ctx.bezierCurveTo(20, 8.4, 19.8, 14.6, 12, 19.8);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "star": {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? 8 : 3.4;
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const x = 12 + Math.cos(angle) * radius;
        const y = 12.4 + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "book": {
      ctx.beginPath();
      ctx.moveTo(12, 6.6);
      ctx.bezierCurveTo(10, 4.9, 7, 4.7, 4.8, 5.3);
      ctx.lineTo(4.8, 18.4);
      ctx.bezierCurveTo(7, 17.9, 10, 18.1, 12, 19.4);
      ctx.bezierCurveTo(14, 18.1, 17, 17.9, 19.2, 18.4);
      ctx.lineTo(19.2, 5.3);
      ctx.bezierCurveTo(17, 4.7, 14, 4.9, 12, 6.6);
      ctx.closePath();
      ctx.moveTo(12, 6.6);
      ctx.lineTo(12, 19.4);
      ctx.stroke();
      break;
    }
    case "briefcase": {
      ctx.beginPath();
      ctx.rect(4, 9, 16, 10.5);
      ctx.moveTo(9, 9);
      ctx.lineTo(9, 6);
      ctx.lineTo(15, 6);
      ctx.lineTo(15, 9);
      ctx.moveTo(4, 13.4);
      ctx.lineTo(20, 13.4);
      ctx.stroke();
      break;
    }
    case "music": {
      ctx.beginPath();
      ctx.moveTo(9, 16.6);
      ctx.lineTo(9, 6.4);
      ctx.lineTo(18, 4.7);
      ctx.lineTo(18, 14.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(6.8, 17.3, 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(15.8, 15.3, 2.2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "health": {
      ctx.beginPath();
      ctx.moveTo(12, 5);
      ctx.lineTo(12, 19);
      ctx.moveTo(5, 12);
      ctx.lineTo(19, 12);
      ctx.stroke();
      break;
    }
    case "money": {
      ctx.beginPath();
      ctx.rect(3.5, 7, 17, 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 12, 2.6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "food": {
      ctx.beginPath();
      ctx.moveTo(7, 4);
      ctx.lineTo(7, 20);
      ctx.moveTo(4.5, 4);
      ctx.lineTo(4.5, 9);
      ctx.quadraticCurveTo(4.5, 11.4, 7, 11.4);
      ctx.quadraticCurveTo(9.5, 11.4, 9.5, 9);
      ctx.lineTo(9.5, 4);
      ctx.moveTo(16.5, 4);
      ctx.lineTo(16.5, 20);
      ctx.moveTo(16.5, 4);
      ctx.quadraticCurveTo(20, 6.5, 20, 10.5);
      ctx.lineTo(16.5, 10.5);
      ctx.stroke();
      break;
    }
    case "car": {
      ctx.beginPath();
      ctx.moveTo(4.5, 16.6);
      ctx.lineTo(4.5, 13);
      ctx.lineTo(7, 8.4);
      ctx.lineTo(17, 8.4);
      ctx.lineTo(19.5, 13);
      ctx.lineTo(19.5, 16.6);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(8, 16.6, 1.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(16, 16.6, 1.8, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "plane": {
      ctx.beginPath();
      ctx.moveTo(4, 12);
      ctx.lineTo(20, 4.5);
      ctx.lineTo(14.5, 20);
      ctx.lineTo(11, 13.2);
      ctx.closePath();
      ctx.moveTo(11, 13.2);
      ctx.lineTo(20, 4.5);
      ctx.stroke();
      break;
    }
    case "tree": {
      ctx.beginPath();
      ctx.moveTo(12, 3.6);
      ctx.lineTo(18.5, 14);
      ctx.lineTo(5.5, 14);
      ctx.closePath();
      ctx.moveTo(12, 14);
      ctx.lineTo(12, 20.4);
      ctx.stroke();
      break;
    }
    case "sun": {
      ctx.beginPath();
      ctx.arc(12, 12, 3.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        ctx.moveTo(12 + Math.cos(angle) * 6.2, 12 + Math.sin(angle) * 6.2);
        ctx.lineTo(12 + Math.cos(angle) * 8.6, 12 + Math.sin(angle) * 8.6);
      }
      ctx.stroke();
      break;
    }
    case "moon": {
      ctx.beginPath();
      ctx.moveTo(17.6, 6.4);
      ctx.bezierCurveTo(12, 3.8, 5, 8, 6.5, 15);
      ctx.bezierCurveTo(7.5, 19, 12, 21, 16, 18.6);
      ctx.bezierCurveTo(10.4, 17, 9, 10.4, 17.6, 6.4);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case "flag": {
      ctx.beginPath();
      ctx.moveTo(6.5, 4);
      ctx.lineTo(6.5, 20);
      ctx.moveTo(6.5, 5.2);
      ctx.lineTo(18, 5.2);
      ctx.lineTo(15.4, 9.6);
      ctx.lineTo(18, 14);
      ctx.lineTo(6.5, 14);
      ctx.stroke();
      break;
    }
    case "globe": {
      ctx.beginPath();
      ctx.arc(12, 12, 7.6, 0, Math.PI * 2);
      ctx.moveTo(4.4, 12);
      ctx.lineTo(19.6, 12);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(12, 12, 3.3, 7.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "camera": {
      ctx.beginPath();
      ctx.rect(3.5, 7.6, 17, 11.4);
      ctx.moveTo(8.4, 7.6);
      ctx.lineTo(10, 5);
      ctx.lineTo(14, 5);
      ctx.lineTo(15.6, 7.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(12, 13.2, 3.2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "document": {
      ctx.beginPath();
      ctx.rect(6.4, 4.6, 11.2, 14.8);
      ctx.moveTo(9.4, 9);
      ctx.lineTo(14.6, 9);
      ctx.moveTo(9.4, 12.8);
      ctx.lineTo(14.6, 12.8);
      ctx.stroke();
      break;
    }
    default: {
      ctx.beginPath();
      ctx.arc(12, 7.6, 3.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(5, 19.6);
      ctx.quadraticCurveTo(5, 13.2, 12, 13.2);
      ctx.quadraticCurveTo(19, 13.2, 19, 19.6);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}
