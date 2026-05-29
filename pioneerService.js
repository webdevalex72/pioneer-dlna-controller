const net = require('net');

const PIONEER_IP = '192.168.1.129';
const TCP_PORT = 8102;

class PioneerService {
    constructor() {
        this.socket = null;
        this.isConnected = false;
        this.powerState = 'OFF'; // <--- ДОБАВИЛИ ПЕРЕМЕННУЮ СОСТОЯНИЯ

        this.onStateChange = null;
        this.onStatus = null;
        this.onLog = null;
    }

    connect() {
        console.log(`[Pioneer] Подключение к ${PIONEER_IP}:${TCP_PORT}...`);
        this.socket = new net.Socket();

        this.socket.connect(TCP_PORT, PIONEER_IP, () => {
            console.log('[Pioneer] Связь по TCP установлена!');
            this.isConnected = true;
            if (this.onStatus) this.onStatus(true);
            this.sendCmd('?P');
        });

        this.socket.on('data', (data) => {
            const raw = data.toString().trim();
            if (this.onLog) this.onLog(raw);
            this.parseResponse(raw);
        });

        this.socket.on('close', () => {
            this.isConnected = false;
            this.powerState = 'OFF';
            if (this.onStatus) this.onStatus(false);
            setTimeout(() => this.connect(), 5000);
        });

        this.socket.on('error', (err) => {
            // Ошибки игнорируем
        });
    }

    sendCmd(cmd) {
        if (this.isConnected && this.socket) {
            this.socket.write(cmd + '\r');
        }
    }

    parseResponse(data) {
        if (data.startsWith('PWR')) {
            // PWR0 = Включен, PWR1 = Standby
            this.powerState = data.substring(3) === '0' ? 'ON' : 'OFF';
            if (this.onStateChange) this.onStateChange('power', this.powerState);
            console.log(`[TCP] Статус питания обновлен: ${this.powerState}`);
        }
    }
}

module.exports = new PioneerService();