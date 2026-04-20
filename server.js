const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// ------------------- CLASSE MANCALA (Kalah) -------------------
class Mancala {
    constructor() {
        // 6 casas por jogador + 2 kalahs (depósitos)
        // Índices: 0-5 = casas do jogador Sul (inferior, índice 0 é a mais à esquerda na visão do jogador sul)
        // 6 = kalah do Sul
        // 7-12 = casas do jogador Norte (superior)
        // 13 = kalah do Norte
        this.tabuleiro = Array(14).fill(4);
        this.tabuleiro[6] = 0;   // kalah sul
        this.tabuleiro[13] = 0;  // kalah norte
        this.turno = 'sul';      // 'sul' ou 'norte'
        this.gameOver = false;
        this.vencedor = null;
    }

    // Retorna uma cópia do estado para envio ao cliente
    getState() {
        return {
            tabuleiro: [...this.tabuleiro],
            turno: this.turno,
            gameOver: this.gameOver,
            vencedor: this.vencedor,
            pontuacao: { sul: this.tabuleiro[6], norte: this.tabuleiro[13] }
        };
    }

    // Verifica se a casa escolhida é válida para o jogador atual
    isMovimentoValido(casa, jogador) {
        if (this.gameOver) return false;
        if (jogador !== this.turno) return false;
        if (jogador === 'sul' && (casa < 0 || casa > 5)) return false;
        if (jogador === 'norte' && (casa < 7 || casa > 12)) return false;
        const indice = jogador === 'sul' ? casa : casa;
        return this.tabuleiro[indice] > 0;
    }

    // Executa um movimento, retorna true se movimento extra (jogar novamente)
    executarMovimento(casa, jogador) {
        if (!this.isMovimentoValido(casa, jogador)) return false;

        let indice = jogador === 'sul' ? casa : casa;
        let sementes = this.tabuleiro[indice];
        this.tabuleiro[indice] = 0;

        let pos = indice;
        while (sementes > 0) {
            pos = (pos + 1) % 14;
            // Pula o kalah do oponente
            if ((jogador === 'sul' && pos === 13) || (jogador === 'norte' && pos === 6)) {
                continue;
            }
            this.tabuleiro[pos]++;
            sementes--;
        }

        // Verifica captura (última semente caiu em casa vazia do próprio lado e casa oposta tem sementes)
        let capturou = false;
        if (jogador === 'sul' && pos >= 0 && pos <= 5 && this.tabuleiro[pos] === 1) {
            const oposto = 12 - pos;
            if (this.tabuleiro[oposto] > 0) {
                this.tabuleiro[6] += this.tabuleiro[oposto] + 1;
                this.tabuleiro[oposto] = 0;
                this.tabuleiro[pos] = 0;
                capturou = true;
            }
        } else if (jogador === 'norte' && pos >= 7 && pos <= 12 && this.tabuleiro[pos] === 1) {
            const oposto = 12 - pos;
            if (this.tabuleiro[oposto] > 0) {
                this.tabuleiro[13] += this.tabuleiro[oposto] + 1;
                this.tabuleiro[oposto] = 0;
                this.tabuleiro[pos] = 0;
                capturou = true;
            }
        }

        // Verifica fim de jogo (um lado sem sementes)
        const sulVazio = this.tabuleiro.slice(0, 6).every(v => v === 0);
        const norteVazio = this.tabuleiro.slice(7, 13).every(v => v === 0);
        if (sulVazio || norteVazio) {
            // Coleta sementes restantes para o respectivo kalah
            if (sulVazio) {
                for (let i = 7; i <= 12; i++) {
                    this.tabuleiro[13] += this.tabuleiro[i];
                    this.tabuleiro[i] = 0;
                }
            } else {
                for (let i = 0; i <= 5; i++) {
                    this.tabuleiro[6] += this.tabuleiro[i];
                    this.tabuleiro[i] = 0;
                }
            }
            this.gameOver = true;
            if (this.tabuleiro[6] > this.tabuleiro[13]) this.vencedor = 'sul';
            else if (this.tabuleiro[13] > this.tabuleiro[6]) this.vencedor = 'norte';
            else this.vencedor = 'empate';
        }

        // Define próximo turno (se última semente caiu no próprio kalah, mesmo jogador joga de novo)
        const turnoExtra = (jogador === 'sul' && pos === 6) || (jogador === 'norte' && pos === 13);
        if (!this.gameOver) {
            this.turno = turnoExtra ? jogador : (jogador === 'sul' ? 'norte' : 'sul');
        }

        return { turnoExtra, capturou, estado: this.getState() };
    }

    reset() {
        this.tabuleiro = Array(14).fill(4);
        this.tabuleiro[6] = 0;
        this.tabuleiro[13] = 0;
        this.turno = 'sul';
        this.gameOver = false;
        this.vencedor = null;
    }
}

// ------------------- SERVIDOR SOCKET.IO -------------------
const TEMPO_INICIAL = 600; // 10 minutos (opcional, pode remover)
let salas = {};

function resetarSalaParaLobby(sala) {
    sala.rodando = false;
    sala.jogo.reset();
    sala.historico = [];
    sala.ofertasEmpate = {};
    
    sala.jogadores.forEach(jogador => {
        jogador.tempo = TEMPO_INICIAL;
        jogador.pronto = false;
    });

    if (sala.intervaloRelogio) {
        clearInterval(sala.intervaloRelogio);
        sala.intervaloRelogio = null;
    }
}

function iniciarRelogio(salaId) {
    // Implementação opcional de relógio. Pode ser ignorada para Mancala.
    // Manteremos vazio para simplificar, mas você pode adaptar se quiser.
}

io.on('connection', (socket) => {
    console.log('🌱 Novo jogador conectado:', socket.id);

    socket.on('entrarSala', ({ apelido, sala: nomeSala }) => {
        socket.join(nomeSala);
        socket.sala = nomeSala;
        socket.apelido = apelido;

        if (!salas[nomeSala]) {
            salas[nomeSala] = {
                jogadores: [],
                espectadores: [],
                rodando: false,
                jogo: new Mancala(),
                historico: [],
                intervaloRelogio: null,
                ofertasEmpate: {}
            };
        }

        const sala = salas[nomeSala];

        if (sala.jogadores.find(j => j.id === socket.id)) {
            socket.emit('erro', 'Você já está nesta sala!');
            return;
        }

        if (sala.jogadores.length < 2) {
            const lado = sala.jogadores.length === 0 ? 'sul' : 'norte';
            sala.jogadores.push({
                id: socket.id,
                nome: apelido,
                pronto: false,
                lado: lado,
                tempo: TEMPO_INICIAL
            });
            socket.emit('definirPapel', { papel: 'jogador', lado: lado });
            console.log(`[Sala ${nomeSala}] Jogador ${apelido} (${lado}) entrou.`);
        } else {
            sala.espectadores.push({ id: socket.id, nome: apelido });
            socket.emit('definirPapel', { papel: 'espectador' });
            socket.emit('estadoAtual', sala.jogo.getState());
            console.log(`[Sala ${nomeSala}] Espectador ${apelido} entrou.`);
        }

        io.to(nomeSala).emit('estadoLobby', {
            rodando: sala.rodando,
            jogadoresInfo: sala.jogadores.map(j => ({
                nome: j.nome,
                pronto: j.pronto,
                lado: j.lado
            })),
            espectadores: sala.espectadores.map(e => e.nome)
        });
    });

    socket.on('marcarPronto', () => {
        const nomeSala = socket.sala;
        const sala = salas[nomeSala];
        if (!sala) return;

        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) return;

        jogador.pronto = true;
        io.to(nomeSala).emit('estadoLobby', {
            rodando: sala.rodando,
            jogadoresInfo: sala.jogadores.map(j => ({
                nome: j.nome,
                pronto: j.pronto,
                lado: j.lado
            })),
            espectadores: sala.espectadores.map(e => e.nome)
        });

        const todosProntos = sala.jogadores.length === 2 && sala.jogadores.every(j => j.pronto);
        if (todosProntos && !sala.rodando) {
            sala.rodando = true;
            sala.jogo.reset();
            sala.historico = [];
            sala.ofertasEmpate = {};
            
            sala.jogadores.forEach(jog => {
                io.to(jog.id).emit('iniciarPartida', { lado: jog.lado, estado: sala.jogo.getState() });
            });
            sala.espectadores.forEach(esp => {
                io.to(esp.id).emit('iniciarPartida', { lado: 'espectador', estado: sala.jogo.getState() });
            });

            io.to(nomeSala).emit('estadoLobby', {
                rodando: true,
                jogadoresInfo: sala.jogadores.map(j => ({
                    nome: j.nome,
                    pronto: j.pronto,
                    lado: j.lado
                })),
                espectadores: sala.espectadores.map(e => e.nome)
            });
            console.log(`[Sala ${nomeSala}] Partida iniciada!`);
        }
    });

    socket.on('fazerJogada', ({ casa }) => {
        const nomeSala = socket.sala;
        const sala = salas[nomeSala];
        if (!sala || !sala.rodando) return;

        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) {
            socket.emit('erro', 'Você não é um jogador desta partida.');
            return;
        }

        const resultado = sala.jogo.executarMovimento(casa, jogador.lado);
        if (resultado === false) {
            socket.emit('erro', 'Movimento inválido.');
            return;
        }

        const estado = sala.jogo.getState();
        const lanceDescricao = `${jogador.lado} moveu casa ${casa}`;
        sala.historico.push(lanceDescricao);

        io.to(nomeSala).emit('jogadaFeita', {
            estado: estado,
            historico: sala.historico,
            lance: lanceDescricao,
            turnoExtra: resultado.turnoExtra
        });

        if (estado.gameOver) {
            resetarSalaParaLobby(sala);
            let mensagem = '';
            if (estado.vencedor === 'sul') mensagem = 'Jogador Sul venceu!';
            else if (estado.vencedor === 'norte') mensagem = 'Jogador Norte venceu!';
            else mensagem = 'Empate!';
            
            io.to(nomeSala).emit('fimDeJogo', {
                motivo: 'fim_normal',
                vencedor: estado.vencedor,
                mensagem: mensagem
            });

            io.to(nomeSala).emit('estadoLobby', {
                rodando: sala.rodando,
                jogadoresInfo: sala.jogadores.map(j => ({
                    nome: j.nome,
                    pronto: j.pronto,
                    lado: j.lado
                })),
                espectadores: sala.espectadores.map(e => e.nome)
            });
            console.log(`[Sala ${nomeSala}] Fim de jogo: ${mensagem}`);
        }
    });

    socket.on('enviarMensagem', (mensagem) => {
        const nomeSala = socket.sala;
        if (!nomeSala) return;
        const remetente = socket.apelido || 'Anônimo';
        io.to(nomeSala).emit('novaMensagem', {
            remetente: remetente,
            texto: mensagem,
            timestamp: Date.now()
        });
    });

    socket.on('desistir', () => {
        const nomeSala = socket.sala;
        const sala = salas[nomeSala];
        if (!sala || !sala.rodando) return;

        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) return;

        const vencedor = jogador.lado === 'sul' ? 'norte' : 'sul';
        resetarSalaParaLobby(sala);

        io.to(nomeSala).emit('fimDeJogo', {
            motivo: 'desistencia',
            vencedor: vencedor,
            mensagem: `${jogador.nome} desistiu. ${vencedor === 'sul' ? 'Sul' : 'Norte'} vence.`
        });

        io.to(nomeSala).emit('estadoLobby', {
            rodando: sala.rodando,
            jogadoresInfo: sala.jogadores.map(j => ({
                nome: j.nome,
                pronto: j.pronto,
                lado: j.lado
            })),
            espectadores: sala.espectadores.map(e => e.nome)
        });
        console.log(`[Sala ${nomeSala}] ${jogador.nome} desistiu.`);
    });

    socket.on('oferecerEmpate', () => {
        const nomeSala = socket.sala;
        const sala = salas[nomeSala];
        if (!sala || !sala.rodando) return;

        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) return;

        if (sala.ofertasEmpate[socket.id]) {
            socket.emit('erro', 'Você já ofereceu empate nesta partida.');
            return;
        }

        const adversario = sala.jogadores.find(j => j.id !== socket.id);
        if (!adversario) return;

        sala.ofertasEmpate[socket.id] = true;

        io.to(nomeSala).emit('propostaEmpate', {
            de: jogador.nome,
            deId: socket.id,
            para: adversario.id
        });
        console.log(`[Sala ${nomeSala}] ${jogador.nome} ofereceu empate.`);
    });

    socket.on('responderEmpate', (resposta) => {
        const nomeSala = socket.sala;
        const sala = salas[nomeSala];
        if (!sala || !sala.rodando) return;

        if (resposta.aceito) {
            resetarSalaParaLobby(sala);

            io.to(nomeSala).emit('fimDeJogo', {
                motivo: 'empate_aceito',
                vencedor: null,
                mensagem: 'Empate aceito! Partida finalizada.'
            });

            io.to(nomeSala).emit('estadoLobby', {
                rodando: sala.rodando,
                jogadoresInfo: sala.jogadores.map(j => ({
                    nome: j.nome,
                    pronto: j.pronto,
                    lado: j.lado
                })),
                espectadores: sala.espectadores.map(e => e.nome)
            });
            console.log(`[Sala ${nomeSala}] Empate aceito.`);
        } else {
            const ofertante = sala.jogadores.find(j => j.nome === resposta.de);
            if (ofertante) {
                io.to(ofertante.id).emit('empateRecusado', { por: socket.apelido });
                console.log(`[Sala ${nomeSala}] Empate recusado por ${socket.apelido}.`);
            }
        }
    });

    socket.on('disconnect', () => {
        const nomeSala = socket.sala;
        if (!nomeSala || !salas[nomeSala]) return;

        const sala = salas[nomeSala];
        console.log(`[Sala ${nomeSala}] ${socket.apelido || socket.id} desconectou.`);

        const jogadorIndex = sala.jogadores.findIndex(j => j.id === socket.id);
        if (jogadorIndex !== -1) {
            sala.jogadores.splice(jogadorIndex, 1);
            
            if (sala.rodando) {
                const vencedor = sala.jogadores[0]?.lado;
                resetarSalaParaLobby(sala);
                
                if (vencedor) {
                    io.to(nomeSala).emit('fimDeJogo', {
                        motivo: 'desconexao',
                        vencedor: vencedor,
                        mensagem: 'Oponente desconectou. Você vence!'
                    });
                }
                io.to(nomeSala).emit('estadoLobby', {
                    rodando: sala.rodando,
                    jogadoresInfo: sala.jogadores.map(j => ({
                        nome: j.nome,
                        pronto: j.pronto,
                        lado: j.lado
                    })),
                    espectadores: sala.espectadores.map(e => e.nome)
                });
            }
        } else {
            sala.espectadores = sala.espectadores.filter(e => e.id !== socket.id);
        }

        if (sala.jogadores.length === 0 && sala.espectadores.length === 0) {
            if (sala.intervaloRelogio) clearInterval(sala.intervaloRelogio);
            delete salas[nomeSala];
            console.log(`[Sala ${nomeSala}] Sala removida.`);
        } else {
            io.to(nomeSala).emit('estadoLobby', {
                rodando: sala.rodando,
                jogadoresInfo: sala.jogadores.map(j => ({
                    nome: j.nome,
                    pronto: j.pronto,
                    lado: j.lado
                })),
                espectadores: sala.espectadores.map(e => e.nome)
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🌱 Motor Mancala rodando na porta ${PORT}`);
});