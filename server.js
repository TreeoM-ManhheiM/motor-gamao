const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ========== CLASSE GAMAO (REGRAS OFICIAIS) ==========
class Gamao {
    constructor() {
        this.reset();
    }

    reset() {
        this.board = Array(24).fill(0);
        this.bar = [0, 0];
        this.home = [0, 0];

        // ========== DISTRIBUIÇÃO INICIAL CLÁSSICA (ESPELHADA) ==========
        // Jogador 1 (Vermelho / positivo) – casas 1, 12, 17, 19
        this.board[0] = 2;   // casa 1
        this.board[11] = 5;  // casa 12
        this.board[16] = 3;  // casa 17
        this.board[18] = 5;  // casa 19

        // Jogador 2 (Branco / negativo) – casas 24, 13, 8, 6 (espelhadas)
        this.board[23] = -2; // casa 24
        this.board[12] = -5; // casa 13
        this.board[7] = -3;  // casa 8
        this.board[5] = -5;  // casa 6

        this.turn = 1;            // 1 = jogador 1 (Vermelho), -1 = jogador 2 (Branco)
        this.dice = [0, 0];
        this.diceUsed = [false, false];
        this.rollPhase = true;
        this.gameOver = false;
        this.winner = null;
        this.doublingCube = 1;
        this.doublingOwner = null;
    }

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

    rollDice() {
        if (!this.rollPhase || this.gameOver) return null;
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        this.dice = [d1, d2].sort((a,b) => a - b);
        this.diceUsed = [false, false];
        this.rollPhase = false;
        return [...this.dice];
    }

    // Retorna array de movimentos legais para o jogador atual (formato usado pelo front-end)
    getLegalMoves(player) {
        if (this.rollPhase || this.gameOver || this.turn !== player) return [];
        const moves = [];
        const barIdx = player === 1 ? 0 : 1;
        const hasBar = this.bar[barIdx] > 0;

        if (hasBar) {
            for (let dieIdx = 0; dieIdx < 2; dieIdx++) {
                if (this.diceUsed[dieIdx]) continue;
                const die = this.dice[dieIdx];
                const to = player === 1 ? die - 1 : 24 - die;
                if (this.isValidMove(24 + barIdx, to, player, dieIdx)) {
                    moves.push({ from: 24 + barIdx, to });
                }
            }
            return moves;
        }

        const diceOptions = this.generateDiceOptions();
        for (let opt of diceOptions) {
            const dieValues = opt.values;
            const dieIndices = opt.indices;
            this.generateMoveSequences(player, dieValues, dieIndices, [], moves);
        }

        // Remove duplicatas e prioriza usar o máximo de dados possível
        const uniqueMoves = [];
        const seen = new Set();
        for (let m of moves) {
            const key = m.moves.map(mv => `${mv.from}-${mv.to}`).join('|');
            if (!seen.has(key)) {
                seen.add(key);
                uniqueMoves.push(m);
            }
        }
        const maxDice = Math.max(...uniqueMoves.map(m => m.dieIndices.length), 0);
        return uniqueMoves.filter(m => m.dieIndices.length === maxDice);
    }

    generateDiceOptions() {
        if (this.dice[0] === this.dice[1]) {
            return [{ values: [this.dice[0], this.dice[0], this.dice[0], this.dice[0]], indices: [0,1,0,1] }];
        } else {
            return [
                { values: [this.dice[0], this.dice[1]], indices: [0,1] },
                { values: [this.dice[1], this.dice[0]], indices: [1,0] }
            ];
        }
    }

    generateMoveSequences(player, remainingDice, remainingIndices, currentSeq, moves) {
        if (remainingDice.length === 0) {
            if (currentSeq.length > 0) {
                moves.push({ moves: currentSeq, dieIndices: remainingIndices.slice(0, currentSeq.length) });
            }
            return;
        }

        const die = remainingDice[0];
        const dieIdx = remainingIndices[0];
        const singleMoves = this.getSingleMoves(player, die, dieIdx);
        if (singleMoves.length === 0) {
            if (currentSeq.length > 0) {
                moves.push({ moves: currentSeq, dieIndices: remainingIndices.slice(0, currentSeq.length) });
            }
            return;
        }

        for (let move of singleMoves) {
            const simState = this.simulateMove(move.from, move.to, player);
            const simGame = new Gamao();
            simGame.board = [...simState.board];
            simGame.bar = [...simState.bar];
            simGame.home = [...simState.home];
            simGame.turn = player;
            simGame.generateMoveSequences(player, remainingDice.slice(1), remainingIndices.slice(1), 
                [...currentSeq, move], moves);
        }
    }

    getSingleMoves(player, die, dieIdx) {
        const moves = [];
        const barIdx = player === 1 ? 0 : 1;
        const hasBar = this.bar[barIdx] > 0;

        if (hasBar) {
            const to = player === 1 ? die - 1 : 24 - die;
            if (this.isValidMove(24 + barIdx, to, player, dieIdx)) {
                moves.push({ from: 24 + barIdx, to });
            }
            return moves;
        }

        const canBearOff = this.canBearOff(player);
        for (let from = 0; from < 24; from++) {
            const count = this.board[from];
            if ((player === 1 && count <= 0) || (player === -1 && count >= 0)) continue;
            const to = player === 1 ? from + die : from - die;
            if (to >= 0 && to <= 23) {
                if (this.isValidMove(from, to, player, dieIdx)) {
                    moves.push({ from, to });
                }
            } else if (canBearOff) {
                const required = player === 1 ? 24 - from : from + 1;
                if (die === required) {
                    if (this.isValidMove(from, -1, player, dieIdx)) moves.push({ from, to: -1 });
                } else if (die > required) {
                    let hasFurther = false;
                    for (let i = 0; i < 24; i++) {
                        const cnt = this.board[i];
                        if ((player === 1 && cnt > 0) || (player === -1 && cnt < 0)) {
                            const dist = player === 1 ? 24 - i : i + 1;
                            if (dist > required) { hasFurther = true; break; }
                        }
                    }
                    if (!hasFurther && this.isValidMove(from, -1, player, dieIdx)) moves.push({ from, to: -1 });
                }
            }
        }
        return moves;
    }

    isValidMove(from, to, player, dieIdx) {
        if (this.gameOver) return false;
        if (this.diceUsed[dieIdx]) return false;
        const barIdx = player === 1 ? 0 : 1;
        const hasBar = this.bar[barIdx] > 0;
        if (hasBar && from !== 24 + barIdx) return false;
        if (!hasBar && (from === 24 || from === 25)) return false;

        let pieceCount;
        if (from === 24 || from === 25) pieceCount = this.bar[from - 24];
        else pieceCount = this.board[from];
        if ((player === 1 && pieceCount <= 0) || (player === -1 && pieceCount >= 0)) return false;

        if (to === -1) {
            if (!this.canBearOff(player)) return false;
            const required = player === 1 ? 24 - from : from + 1;
            const die = this.dice[dieIdx];
            if (die < required) return false;
            if (die > required) {
                for (let i = 0; i < 24; i++) {
                    const cnt = this.board[i];
                    if ((player === 1 && cnt > 0) || (player === -1 && cnt < 0)) {
                        const dist = player === 1 ? 24 - i : i + 1;
                        if (dist > required) return false;
                    }
                }
            }
            return true;
        }

        const die = this.dice[dieIdx];
        let distance;
        if (from === 24 || from === 25) {
            distance = player === 1 ? to + 1 : 24 - to;
            if (distance !== die) return false;
        } else {
            distance = player === 1 ? to - from : from - to;
            if (distance !== die) return false;
        }

        const destCount = this.board[to];
        if ((player === 1 && destCount < -1) || (player === -1 && destCount > 1)) return false;
        return true;
    }

    canBearOff(player) {
        const homeStart = player === 1 ? 18 : 0;
        const homeEnd = player === 1 ? 23 : 5;
        for (let i = 0; i < 24; i++) {
            const cnt = this.board[i];
            if ((player === 1 && cnt > 0) || (player === -1 && cnt < 0)) {
                if (i < homeStart || i > homeEnd) return false;
            }
        }
        return this.bar[player === 1 ? 0 : 1] === 0;
    }

    simulateMove(from, to, player) {
        const newBoard = [...this.board];
        const newBar = [...this.bar];
        const newHome = [...this.home];
        if (from === 24 || from === 25) {
            newBar[from - 24]--;
        } else {
            player === 1 ? newBoard[from]-- : newBoard[from]++;
        }
        if (to === -1) {
            newHome[player === 1 ? 0 : 1]++;
        } else {
            const dest = newBoard[to];
            if ((player === 1 && dest === -1) || (player === -1 && dest === 1)) {
                newBar[player === 1 ? 1 : 0]++;
                newBoard[to] = 0;
            }
            player === 1 ? newBoard[to]++ : newBoard[to]--;
        }
        return { board: newBoard, bar: newBar, home: newHome };
    }

    makeMove(moves) {
        if (!moves || moves.length === 0) return false;
        const player = this.turn;
        const usedIndices = [];

        for (let move of moves) {
            const dieValue = player === 1 ? (move.from === 24 ? move.to + 1 : move.to - move.from) :
                            (move.from === 25 ? 24 - move.to : move.from - move.to);
            const dieIdx = this.dice.findIndex((v, i) => v === dieValue && !this.diceUsed[i] && !usedIndices.includes(i));
            if (dieIdx === -1) return false;
            usedIndices.push(dieIdx);

            if (move.from === 24 || move.from === 25) {
                this.bar[move.from - 24]--;
            } else {
                player === 1 ? this.board[move.from]-- : this.board[move.from]++;
            }
            if (move.to === -1) {
                this.home[player === 1 ? 0 : 1]++;
            } else {
                const dest = this.board[move.to];
                if ((player === 1 && dest === -1) || (player === -1 && dest === 1)) {
                    this.bar[player === 1 ? 1 : 0]++;
                    this.board[move.to] = 0;
                }
                player === 1 ? this.board[move.to]++ : this.board[move.to]--;
            }
        }

        usedIndices.forEach(idx => this.diceUsed[idx] = true);
        if (this.diceUsed.every(v => v)) {
            this.rollPhase = true;
            this.turn *= -1;
            this.dice = [0, 0];
            this.diceUsed = [false, false];
        }

        if (this.home[0] === 15) {
            this.gameOver = true;
            this.winner = 1;
        } else if (this.home[1] === 15) {
            this.gameOver = true;
            this.winner = -1;
        }
        return true;
    }
}

// ========== GERENCIAMENTO DE SALAS ==========
let salas = {};

function resetarSalaParaLobby(sala) {
    sala.rodando = false;
    sala.jogo.reset();
    sala.historico = [];
    sala.jogadores.forEach(j => j.pronto = false);
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
                historico: []
            };
        }
        const sala = salas[nomeSala];

        if (sala.jogadores.find(j => j.id === socket.id)) {
            socket.emit('erro', 'Você já está nesta sala!');
            return;
        }

        if (sala.jogadores.length < 2) {
            const lado = sala.jogadores.length === 0 ? 1 : -1;
            sala.jogadores.push({ id: socket.id, nome: apelido, pronto: false, lado });
            socket.emit('definirPapel', { papel: 'jogador', lado });
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
            sala.jogadores.forEach(j => io.to(j.id).emit('iniciarPartida', { lado: j.lado, estado: sala.jogo.getState() }));
            sala.espectadores.forEach(e => io.to(e.id).emit('iniciarPartida', { lado: 'espectador', estado: sala.jogo.getState() }));
            io.to(socket.sala).emit('estadoLobby', { rodando: true, jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })), espectadores: sala.espectadores.map(e => e.nome) });
        }
    });

    socket.on('rolarDados', () => {
        const sala = salas[socket.sala];
        if (!sala?.rodando) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador || sala.jogo.turn !== jogador.lado || !sala.jogo.rollPhase) return;
        const dice = sala.jogo.rollDice();
        if (dice) {
            const legalMoves = sala.jogo.getLegalMoves(jogador.lado);
            io.to(socket.sala).emit('dadosRolados', { dice, turn: sala.jogo.turn, legalMoves });
            io.to(socket.sala).emit('estadoAtual', sala.jogo.getState());
        }
    });

    socket.on('moverPecas', ({ moves }) => {
        const sala = salas[socket.sala];
        if (!sala?.rodando) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador || sala.jogo.turn !== jogador.lado || sala.jogo.rollPhase) return;

        if (sala.jogo.makeMove(moves)) {
            const estado = sala.jogo.getState();
            sala.historico.push(`${jogador.nome} moveu ${moves.map(m => `${m.from}→${m.to}`).join(', ')}`);
            const legalMoves = estado.rollPhase ? [] : sala.jogo.getLegalMoves(estado.turn);
            io.to(socket.sala).emit('jogadaFeita', { estado, historico: sala.historico, moves, legalMoves });

            if (estado.gameOver) {
                resetarSalaParaLobby(sala);
                const vencedor = estado.winner === 1 ? 'Vermelho' : 'Branco';
                io.to(socket.sala).emit('fimDeJogo', { motivo: 'fim_normal', vencedor: estado.winner, mensagem: `${vencedor} venceu!` });
                io.to(socket.sala).emit('estadoLobby', { rodando: sala.rodando, jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })), espectadores: sala.espectadores.map(e => e.nome) });
            }
        } else {
            socket.emit('erro', 'Movimento inválido.');
        }
    });

    socket.on('enviarMensagem', (msg) => {
        const sala = socket.sala;
        if (!sala) return;
        io.to(sala).emit('novaMensagem', { remetente: socket.apelido, texto: msg, timestamp: Date.now() });
    });

    socket.on('desistir', () => {
        const sala = salas[socket.sala];
        if (!sala?.rodando) return;
        const jogador = sala.jogadores.find(j => j.id === socket.id);
        if (!jogador) return;
        const vencedor = jogador.lado === 1 ? -1 : 1;
        resetarSalaParaLobby(sala);
        io.to(socket.sala).emit('fimDeJogo', { motivo: 'desistencia', vencedor, mensagem: `${jogador.nome} desistiu.` });
        io.to(socket.sala).emit('estadoLobby', { rodando: sala.rodando, jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })), espectadores: sala.espectadores.map(e => e.nome) });
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
                if (vencedor) io.to(socket.sala).emit('fimDeJogo', { motivo: 'desconexao', vencedor, mensagem: 'Oponente desconectou.' });
                io.to(socket.sala).emit('estadoLobby', { rodando: sala.rodando, jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })), espectadores: sala.espectadores.map(e => e.nome) });
            }
        } else {
            sala.espectadores = sala.espectadores.filter(e => e.id !== socket.id);
        }
        if (sala.jogadores.length === 0 && sala.espectadores.length === 0) delete salas[socket.sala];
        else io.to(socket.sala).emit('estadoLobby', { rodando: sala.rodando, jogadoresInfo: sala.jogadores.map(j => ({ nome: j.nome, pronto: j.pronto, lado: j.lado })), espectadores: sala.espectadores.map(e => e.nome) });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎲 Motor Gamão rodando na porta ${PORT}`));
