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

// --- CLASSE GAMAO (Backgammon) ---
class Gamao {
    constructor() {
        this.reset();
    }

    reset() {
        // Representação do tabuleiro: 26 posições (0-23 pontos, 24 barra do jogador 1, 25 barra do jogador 2)
        // Índices 0-23: pontos do tabuleiro. Valor positivo = peças do jogador 1 (branco/preto), negativo = jogador 2 (vermelho)
        this.board = Array(24).fill(0);
        this.bar = [0, 0]; // Peças na barra: índice 0 = jogador 1 (sul), 1 = jogador 2 (norte)
        this.home = [0, 0]; // Peças removidas (fora do tabuleiro)

        // Setup inicial padrão do Gamão
        this.board[0] = 2;   // Jogador 1
        this.board[11] = -5;  // Jogador 2
        this.board[16] = -3;  // Jogador 2
        this.board[18] = -5;  // Jogador 2
        this.board[5] = -5;   // Jogador 2
        this.board[12] = 5;   // Jogador 1
        this.board[7] = -3;   // Jogador 2
        this.board[23] = -2;  // Jogador 2

        this.turn = 1; // 1 para jogador 1 (sul/vermelho/preto), -1 para jogador 2 (norte/branco) - usaremos 1 e -1 internamente
        this.dice = [0, 0];
        this.diceUsed = [false, false];
        this.rollPhase = true; // true = precisa rolar dados, false = fase de movimento
        this.gameOver = false;
        this.winner = null;
        this.doublingCube = 1;
        this.doublingOwner = null; // quem pode dobrar
    }

    // Converte o estado para um objeto simples para envio
    getState() {
        return {
            board: [...this.board],
            bar: [...this.bar],
            home: [...this.home],
            turn: this.turn,
            dice: [...this.dice],
            diceUsed: [...this.diceUsed],
            rollPhase: this.rollPhase,
            gameOver: this.gameOver,
            winner: this.winner,
            doublingCube: this.doublingCube,
            doublingOwner: this.doublingOwner
        };
    }

    // Rola dois dados (valores 1-6)
    rollDice() {
        if (!this.rollPhase || this.gameOver) return null;
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        this.dice = [d1, d2];
        this.diceUsed = [false, false];
        this.rollPhase = false;
        // Se os dados forem iguais, são considerados 4 movimentos (ainda lidamos com dois valores, mas a UI pode interpretar)
        return [...this.dice];
    }

    // Valida se um movimento é legal
    isValidMove(from, to, player) {
        if (this.gameOver) return false;
        if (this.turn !== player) return false;
        if (this.rollPhase) return false;

        // Verifica se há peças na barra que precisam ser movidas primeiro
        const barIdx = player === 1 ? 0 : 1;
        if (this.bar[barIdx] > 0) {
            // Só pode mover da barra
            if (from !== 24 + barIdx) return false;
        } else {
            // Não pode mover da barra se não houver peças lá
            if (from === 24 || from === 25) return false;
        }

        // Verifica se a peça pertence ao jogador
        let pieceCount = 0;
        if (from === 24 || from === 25) {
            pieceCount = this.bar[from - 24];
        } else {
            pieceCount = this.board[from];
        }
        if ((player === 1 && pieceCount <= 0) || (player === -1 && pieceCount >= 0)) return false;

        // Verifica se o destino é válido (0-23 ou home)
        if (to < 0 || to > 23) {
            // Verifica se pode remover peças (bearing off)
            if (!this.canBearOff(player)) return false;
            // Movimento para fora do tabuleiro é representado por to = -1
            if (to !== -1) return false;
        }

        // Calcula a distância percorrida
        let distance;
        if (from === 24 || from === 25) {
            // Da barra: reentrada na casa 24 - from? Na verdade, a reentrada é na casa correspondente ao dado
            // Simplificação: a distância é validada pelo dado escolhido
            const entryPoint = player === 1 ? to : 23 - to;
            distance = player === 1 ? to + 1 : 24 - to;
        } else {
            distance = player === 1 ? to - from : from - to;
        }

        // Verifica se a distância corresponde a um dos dados disponíveis
        let diceIndex = -1;
        for (let i = 0; i < this.dice.length; i++) {
            if (!this.diceUsed[i] && this.dice[i] === distance) {
                diceIndex = i;
                break;
            }
        }
        // Se não encontrou, verifica se pode usar um valor maior para bearing off
        if (diceIndex === -1 && to === -1) {
            // No bearing off, pode usar um dado maior se for a peça mais distante
            // Simplificaremos: permite se o dado for maior ou igual
            for (let i = 0; i < this.dice.length; i++) {
                if (!this.diceUsed[i] && this.dice[i] >= distance) {
                    diceIndex = i;
                    break;
                }
            }
        }
        if (diceIndex === -1) return false;

        // Verifica se o ponto de destino está bloqueado (2 ou mais peças do oponente)
        if (to >= 0 && to <= 23) {
            const destCount = this.board[to];
            if ((player === 1 && destCount < -1) || (player === -1 && destCount > 1)) {
                return false;
            }
        }

        return true;
    }

    canBearOff(player) {
        // Verifica se todas as peças do jogador estão no seu quadrante interno (home board)
        const homeStart = player === 1 ? 18 : 0;
        const homeEnd = player === 1 ? 23 : 5;
        for (let i = 0; i < 24; i++) {
            const count = this.board[i];
            if ((player === 1 && count > 0) || (player === -1 && count < 0)) {
                if (i < homeStart || i > homeEnd) return false;
            }
        }
        return this.bar[player === 1 ? 0 : 1] === 0;
    }

    // Executa um movimento (sem validação completa, assume que isValidMove foi chamado antes)
    makeMove(from, to, player) {
        if (!this.isValidMove(from, to, player)) return false;

        // Marca o dado como usado
        let distance;
        if (from === 24 || from === 25) {
            distance = player === 1 ? to + 1 : 24 - to;
        } else {
            distance = player === 1 ? to - from : from - to;
        }
        for (let i = 0; i < this.dice.length; i++) {
            if (!this.diceUsed[i] && (this.dice[i] === distance || (to === -1 && this.dice[i] >= distance))) {
                this.diceUsed[i] = true;
                break;
            }
        }

        // Remove a peça da origem
        if (from === 24 || from === 25) {
            this.bar[from - 24]--;
        } else {
            if (player === 1) this.board[from]--;
            else this.board[from]++;
        }

        // Se o destino é fora do tabuleiro, coloca em home
        if (to === -1) {
            this.home[player === 1 ? 0 : 1]++;
        } else {
            // Verifica captura
            const destCount = this.board[to];
            if ((player === 1 && destCount === -1) || (player === -1 && destCount === 1)) {
                // Manda para a barra
                this.bar[player === 1 ? 1 : 0]++;
                this.board[to] = 0;
            }
            // Adiciona a peça ao destino
            if (player === 1) this.board[to]++;
            else this.board[to]--;
        }

        // Verifica se todos os dados foram usados
        if (this.diceUsed.every(v => v)) {
            // Fim da rodada, troca turno e volta para fase de rolagem
            this.rollPhase = true;
            this.turn *= -1;
            this.dice = [0, 0];
            this.diceUsed = [false, false];
        }

        // Verifica condição de vitória
        if (this.home[0] === 15) {
            this.gameOver = true;
            this.winner = 1;
        } else if (this.home[1] === 15) {
            this.gameOver = true;
            this.winner = -1;
        }

        return true;
    }

    // Obtém movimentos possíveis para o jogador atual (retorna array de {from, to})
    getPossibleMoves(player) {
        // Implementação simplificada: retorna movimentos básicos
        // Em um jogo completo, isso seria mais complexo
        return [];
    }
}

// --- GERENCIAMENTO DE SALAS ---
let salas = {};

function resetarSalaParaLobby(sala) {
    sala.rodando = false;
    sala.jogo.reset();
    sala.historico = [];
    sala.ofertasEmpate = {};
    sala.jogadores.forEach(j => { j.pronto = false; });
}

io.on('connection', (socket) => {
    console.log('🎲 Jogador conectado:', socket.id);

    socket.on('entrarSala', ({ apelido, sala: nomeSala }) => {
        socket.join(nomeSala);
        socket.sala = nomeSala;
        socket.apelido = apelido;

        if (!salas[nomeSala]) {
            salas[nomeSala] = {
                jogadores: [],
                espectadores: [],
                rodando: false,
                jogo: new Gamao(),
                historico: [],
                ofertasEmpate: {}
            };
        }
        const sala = salas[nomeSala];

        if (sala.jogadores.find(j => j.id === socket.id)) {
            socket.emit('erro', 'Você já está nesta sala!');
            return;
        }

        if (sala.jogadores.length < 2) {
            const lado = sala.jogadores.length === 0 ? 1 : -1; // 1 = vermelho/preto, -1 = branco
            sala.jogadores.push({
                id: socket.id,
                nome: apelido,
                pronto: false,
                lado: lado
            });
            socket.emit('definirPapel', { papel: 'jogador', lado: lado });
        } else {
            sala.espectadores.push({ id: socket.id, nome: apelido });
            socket.emit('definirPapel', { papel: 'espectador' });
            socket.emit('estadoAtual', sala.jogo.getState());
        }

        io.to(nomeSala).emit('estadoLobby', {
            rodando: sala.rodando,
            jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
            espectadores: sala.espectadores.map(e => e.nome)
        });
    });

    socket.on('marcarPronto', () => {
        const sala = salas[socket.sala];
        if (!sala) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) return;
        jogador.pronto = true;
        io.to(socket.sala).emit('estadoLobby', {
            rodando: sala.rodando,
            jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
            espectadores: sala.espectadores.map(e => e.nome)
        });

        if (sala.jogadores.length === 2 && sala.jogadores.every(j => j.pronto) && !sala.rodando) {
            sala.rodando = true;
            sala.jogo.reset();
            sala.jogo.rollPhase = true; // Começa com fase de rolagem
            sala.jogadores.forEach(j => {
                io.to(j.id).emit('iniciarPartida', { lado: j.lado, estado: sala.jogo.getState() });
            });
            sala.espectadores.forEach(e => {
                io.to(e.id).emit('iniciarPartida', { lado: 'espectador', estado: sala.jogo.getState() });
            });
            io.to(socket.sala).emit('estadoLobby', {
                rodando: true,
                jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
                espectadores: sala.espectadores.map(e => e.nome)
            });
        }
    });

    socket.on('rolarDados', () => {
        const sala = salas[socket.sala];
        if (!sala || !sala.rodando) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador || sala.jogo.turn !== jogador.lado || !sala.jogo.rollPhase) return;
        const dice = sala.jogo.rollDice();
        if (dice) {
            io.to(socket.sala).emit('dadosRolados', { dice, turn: sala.jogo.turn });
            io.to(socket.sala).emit('estadoAtual', sala.jogo.getState());
        }
    });

    socket.on('moverPeca', ({ from, to }) => {
        const sala = salas[socket.sala];
        if (!sala || !sala.rodando) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador || sala.jogo.turn !== jogador.lado) return;

        if (sala.jogo.makeMove(from, to, jogador.lado)) {
            const estado = sala.jogo.getState();
            sala.historico.push(`${jogador.nome} moveu de ${from} para ${to}`);
            io.to(socket.sala).emit('jogadaFeita', { estado, historico: sala.historico });

            if (estado.gameOver) {
                resetarSalaParaLobby(sala);
                const vencedor = estado.winner === 1 ? 'Vermelho' : 'Branco';
                io.to(socket.sala).emit('fimDeJogo', {
                    motivo: 'fim_normal',
                    vencedor: estado.winner,
                    mensagem: `${vencedor} venceu a partida!`
                });
                io.to(socket.sala).emit('estadoLobby', {
                    rodando: sala.rodando,
                    jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
                    espectadores: sala.espectadores.map(e => e.nome)
                });
            } else {
                // Se ainda há movimentos possíveis com os dados, continua; senão, encerra turno
                // A lógica de troca de turno está em makeMove quando todos os dados são usados
            }
        } else {
            socket.emit('erro', 'Movimento inválido.');
        }
    });

    socket.on('enviarMensagem', (msg) => {
        const sala = socket.sala;
        if (!sala) return;
        io.to(sala).emit('novaMensagem', {
            remetente: socket.apelido,
            texto: msg,
            timestamp: Date.now()
        });
    });

    socket.on('desistir', () => {
        const sala = salas[socket.sala];
        if (!sala || !sala.rodando) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) return;
        const vencedor = jogador.lado === 1 ? -1 : 1;
        resetarSalaParaLobby(sala);
        io.to(socket.sala).emit('fimDeJogo', {
            motivo: 'desistencia',
            vencedor,
            mensagem: `${jogador.nome} desistiu.`
        });
        io.to(socket.sala).emit('estadoLobby', {
            rodando: sala.rodando,
            jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
            espectadores: sala.espectadores.map(e => e.nome)
        });
    });

    socket.on('oferecerEmpate', () => {
        // Implementação similar ao Mancala (omitida por brevidade, mas pode ser adicionada)
    });

    socket.on('responderEmpate', (resposta) => {
        // Implementação similar ao Mancala
    });

    socket.on('disconnect', () => {
        const sala = salas[socket.sala];
        if (!sala) return;
        console.log(`[Sala ${socket.sala}] ${socket.apelido} desconectou.`);

        const jogadorIdx = sala.jogadores.findIndex(j => j.id === socket.id);
        if (jogadorIdx !== -1) {
            sala.jogadores.splice(jogadorIdx, 1);
            if (sala.rodando) {
                const vencedor = sala.jogadores[0]?.lado;
                resetarSalaParaLobby(sala);
                if (vencedor) {
                    io.to(socket.sala).emit('fimDeJogo', {
                        motivo: 'desconexao',
                        vencedor,
                        mensagem: 'Oponente desconectou.'
                    });
                }
                io.to(socket.sala).emit('estadoLobby', {
                    rodando: sala.rodando,
                    jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
                    espectadores: sala.espectadores.map(e => e.nome)
                });
            }
        } else {
            sala.espectadores = sala.espectadores.filter(e => e.id !== socket.id);
        }

        if (sala.jogadores.length === 0 && sala.espectadores.length === 0) {
            delete salas[socket.sala];
        } else {
            io.to(socket.sala).emit('estadoLobby', {
                rodando: sala.rodando,
                jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })),
                espectadores: sala.espectadores.map(e => e.nome)
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎲 Motor Gamão rodando na porta ${PORT}`);
});
