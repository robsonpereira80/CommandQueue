define('TWOverflow/Queue', [
    'TWOverflow/locale',
    'helper/time',
    'helper/math',
    'struct/MapData',
    'conf/conf',
    'Lockr'
], function (
    Locale,
    $timeHelper,
    $math,
    $mapData,
    $conf,
    Lockr
) {
    /**
     * Taxa de verificação se há comandos a serem enviados por segundo.
     *
     * @type {Number}
     */
    var CHECKS_PER_SECOND = 5

    /**
     * Armazena todos os eventos adicionados para serem
     * chamados pelo .trigger()
     *
     * @type {Object}
     */
    var eventListeners = {}

    /**
     * Lista de comandos em espera (ordenado por tempo restante).
     *
     * @type {Array}
     */
    var waitingCommands = []

    /**
     * Lista de comandos em espera.
     *
     * @type {Object}
     */
    var waitingCommandsObject = {}

    /**
     * Lista de comandos que já foram enviados.
     *
     * @type {Array}
     */
    var sendedCommands = []

    /**
     * Lista de comandos que se expiraram.
     *
     * @type {Array}
     */
    var expiredCommands = []

    /**
     * Indica se o CommandQueue está ativado.
     *
     * @type {Boolean}
     */
    var running = false

    /**
     * Dados do jogador.
     *
     * @type {Object}
     */
    var $player

    /**
     * Tipos de comandos usados pelo jogo (tipo que usam tropas apenas).
     *
     * @type {Array}
     */
    var commandTypes = ['attack', 'support', 'relocate']

    /**
     * Lista de filtros para comandos.
     *
     * @type {Object}
     */
    var commandFilters = {
        selectedVillage: function (command) {
            return command.origin.id === modelDataService.getSelectedVillage().getId()
        },
        barbarianTarget: function (command) {
            return !command.target.character_id
        },
        allowedTypes: function (command, options) {
            return options.allowedTypes[command.type]
        },
        attack: function (command) {
            return command.type !== 'attack'
        },
        support: function (command) {
            return command.type !== 'support'
        },
        relocate: function (command) {
            return command.type !== 'relocate'
        },
        textMatch: function (command, options) {
            var show = true
            var keywords = options.textMatch.toLowerCase().split(/\W/)

            var searchString = [
                command.origin.name,
                command.originCoords,
                command.originCoords,
                command.origin.character_name || '',
                command.target.name,
                command.targetCoords,
                command.target.character_name || '',
                command.target.tribe_name || '',
                command.target.tribe_tag || ''
            ]

            searchString = searchString.join('').toLowerCase()

            keywords.some(function (keyword) {
                if (keyword.length && !searchString.includes(keyword)) {
                    show = false
                    return true
                }
            })

            return show
        }
    }

    /**
     * Diferença entre o timezone local e do servidor.
     *
     * @type {Number}
     */
    var timeOffset

    /**
     * Obtem a diferença entre o timezone local e do servidor.
     *
     * @type {Number}
     */
    var getTimeOffset = function () {
        var localDate = $timeHelper.gameDate()
        var localOffset = localDate.getTimezoneOffset() * 1000 * 60
        var serverOffset = rootScope.GAME_TIME_OFFSET

        return localOffset + serverOffset
    }

    /**
     * Gera um prefix com o mundo atual para que
     * cada mundo tenha sua própria lista de comandos.
     *
     * @param  {String} id
     * @return {String}
     */
    var worldPrefix = function (id) {
        return $player.getWorldId() + '-' + id
    }

    // TODO
    // Mover alguns utils para um modulo separado,
    // assim evitando que utils que precisem de dados
    // de outros modulos tipo $timeHelper não precisem
    // ser definidos dentro de cada modulo.

    /**
     * Verifica se tem um intervalo entre a horario do envio e o horario do jogo.
     *
     * @param  {Number} - sendTime
     * @return {Boolean}
     */
    var isTimeToSend = function (sendTime) {
        return sendTime < ($timeHelper.gameTime() + timeOffset)
    }

    /**
     * Remove os zeros das unidades passadas pelo jogador.
     * A razão de remover é por que o próprio não os envia
     * quando os comandos são enviados manualmente, então
     * caso seja enviado as unidades com valores zero poderia
     * ser uma forma de detectar os comandos automáticos.
     *
     * @param  {Object} units - Unidades a serem analisadas
     * @return {Object} Objeto sem nenhum valor zero
     */
    var cleanZeroUnits = function (units) {
        var cleanUnits = {}

        for (var unit in units) {
            var amount = units[unit]

            if (amount === '*' || amount !== 0) {
                cleanUnits[unit] = amount
            }
        }

        return cleanUnits
    }

    /**
     * Ordenada a lista de comandos em espera por tempo de saída.
     */
    var sortWaitingQueue = function () {
        waitingCommands = waitingCommands.sort(function (a, b) {
            return a.sendTime - b.sendTime
        })
    }

    /**
     * Adiciona um comando a lista ordenada de comandos em espera.
     *
     * @param  {Object} command - Comando a ser adicionado
     */
    var pushWaitingCommand = function (command) {
        waitingCommands.push(command)
    }

    /**
     * Adiciona um comando a lista de comandos em espera.
     *
     * @param  {Object} command - Comando a ser adicionado
     */
    var pushCommandObject = function (command) {
        waitingCommandsObject[command.id] = command
    }

    /**
     * Adiciona um comando a lista de comandos enviados.
     *
     * @param  {Object} command - Comando a ser adicionado
     */
    var pushSendedCommand = function (command) {
        sendedCommands.push(command)
    }

    /**
     * Adiciona um comando a lista de comandos expirados.
     *
     * @param  {Object} command - Comando a ser adicionado
     */
    var pushExpiredCommand = function (command) {
        expiredCommands.push(command)
    }

    /**
     * Salva a lista de comandos em espera no localStorage.
     */
    var storeWaitingQueue = function () {
        Lockr.set(worldPrefix('queue-commands'), waitingCommands)
    }

    /**
     * Salva a lista de comandos enviados no localStorage.
     */
    var storeSendedQueue = function () {
        Lockr.set(worldPrefix('queue-sended'), sendedCommands)
    }

    /**
     * Salva a lista de comandos expirados no localStorage.
     */
    var storeExpiredQueue = function () {
        Lockr.set(worldPrefix('queue-expired'), expiredCommands)
    }

    /**
     * Carrega a lista de comandos em espera salvos no localStorage
     * e os adiciona ao CommandQueue;
     * Commandos que já deveriam ter saído são movidos para a lista de
     * expirados.
     */
    var loadStoredCommands = function () {
        var storedQueue = Lockr.get(worldPrefix('queue-commands'), [], true)

        if (storedQueue.length) {
            for (var i = 0; i < storedQueue.length; i++) {
                var command = storedQueue[i]

                if ($timeHelper.gameTime() > command.sendTime) {
                    Queue.expireCommand(command)
                } else {
                    pushWaitingCommand(command)
                    pushCommandObject(command)
                }
            }
        }
    }

    /**
     * Transforma valores curingas das unidades.
     * - Asteriscos são convetidos para o núrero total de unidades
     *    que se encontram na aldeia.
     * - Números negativos são convertidos núrero total de unidades
     *    menos a quantidade específicada.
     *
     * @param  {Object} command - Dados do comando
     */
    var parseDynamicUnits = function (command) {
        var playerVillages = modelDataService.getVillages()
        var village = playerVillages[command.origin.id]

        if (!village) {
            return false
        }

        var villageUnits = village.unitInfo.units
        var parsedUnits = {}

        for (var unit in command.units) {
            var amount = command.units[unit]

            if (amount === '*') {
                amount = villageUnits[unit].available

                if (amount === 0) {
                    continue
                }
            } else if (amount < 0) {
                amount = villageUnits[unit].available - Math.abs(amount)

                if (amount < 0) {
                    return false
                }
            }

            parsedUnits[unit] = amount
        }

        return parsedUnits
    }

    /**
     * Inicia a verificação de comandos a serem enviados.
     */
    var listenCommands = function () {
        setInterval(function () {
            if (!waitingCommands.length) {
                return
            }

            waitingCommands.some(function (command) {
                if (isTimeToSend(command.sendTime)) {
                    if (running) {
                        Queue.sendCommand(command)
                    } else {
                        Queue.expireCommand(command)
                    }
                } else {
                    return true
                }
            })
        }, CHECKS_PER_SECOND / 1000)
    }

    /**
     * Métodos e propriedades publicas do CommandQueue.
     *
     * @type {Object}
     */
    var Queue = {}

    /**
     * Indica se o CommandQueue já foi inicializado.
     *
     * @type {Boolean}
     */
    Queue.initialized = false

    /**
     * Versão atual do CommandQueue
     *
     * @type {String}
     */
    Queue.version = '__queue_version'

    /**
     * Inicializa o CommandQueue.
     * Adiciona/expira comandos salvos em execuções anteriores.
     */
    Queue.init = function () {
        Locale.create('queue', __queue_locale, 'en')

        timeOffset = getTimeOffset
        $player = modelDataService.getSelectedCharacter()

        Queue.initialized = true

        sendedCommands = Lockr.get(worldPrefix('queue-sended'), [], true)
        expiredCommands = Lockr.get(worldPrefix('queue-expired'), [], true)

        loadStoredCommands()
        listenCommands()

        window.addEventListener('beforeunload', function (event) {
            if (running && waitingCommands.length) {
                event.returnValue = true
            }
        })
    }

    /**
     * Adiciona um evento.
     *
     * @param  {String} event - Identificação do evento.
     * @param  {Function} handler - Função executado quando o evento é disparado.
     */
    Queue.bind = function (event, handler) {
        if (!eventListeners.hasOwnProperty(event)) {
            eventListeners[event] = []
        }

        eventListeners[event].push(handler)
    }

    /**
     * Dispara um evento.
     * @param  {String} event - Identificação do evento.
     * @param  {Array} args - Lista de argumentos que serão passados ao handler.
     */
    Queue.trigger = function (event, args) {
        if (eventListeners.hasOwnProperty(event)) {
            eventListeners[event].forEach(function (handler) {
                handler.apply(this, args)
            })
        }
    }

    /**
     * Envia um comando.
     *
     * @param {Object} command - Dados do comando que será enviado.
     */
    Queue.sendCommand = function (command) {
        command.units = parseDynamicUnits(command)

        if (!command.units) {
            return Queue.trigger('error', [Locale('queue', 'error.noUnitsEnough')])
        }

        socketService.emit(routeProvider.SEND_CUSTOM_ARMY, {
            start_village: command.origin.id,
            target_village: command.target.id,
            type: command.type,
            units: command.units,
            icon: 0,
            officers: command.officers,
            catapult_target: null
        })

        pushSendedCommand(command)
        storeSendedQueue()

        Queue.removeCommand(command, 'sended')
        Queue.trigger('send', [command])
    }

    /**
     * Expira um comando.
     *
     * @param {Object} command - Dados do comando que será expirado.
     */
    Queue.expireCommand = function (command) {
        pushExpiredCommand(command)
        storeExpiredQueue()

        Queue.removeCommand(command, 'expired')
    }

    /**
     * Adiciona um comando a lista de espera.
     *
     * @param {Object} command - Dados do comando que será adicionado.
     * @param {String} command.origin - Coordenadas da aldeia de origem.
     * @param {String} command.target - Coordenadas da aldeia alvo.
     * @param {String} command.date - Data e hora que o comando deve chegar.
     * @param {Object} command.units - Unidades que serão enviados pelo comando.
     * @param {Object} command.officers - Oficiais que serão enviados pelo comando.
     * @param {String} command.type - Tipo de comando.
     */
    Queue.addCommand = function (command) {
        if (!isValidCoords(command.origin)) {
            return Queue.trigger('error', [Locale('queue', 'error.origin')])
        }

        if (!isValidCoords(command.target)) {
            return Queue.trigger('error', [Locale('queue', 'error.target')])
        }

        if (!isValidDateTime(command.date)) {
            return Queue.trigger('error', [Locale('queue', 'error.invalidDate')])
        }

        if (angular.equals(command.units, {})) {
            return Queue.trigger('error', [Locale('queue', 'error.noUnits')])
        }

        command.originCoords = command.origin
        command.targetCoords = command.target

        var getOriginVillage = new Promise(function (resolve, reject) {
            Queue.getVillageByCoords(command.origin, function (data) {
                if (data) {
                    return resolve(data)
                }

                reject('error.originNotExist')
            })
        })

        var getTargetVillage = new Promise(function (resolve, reject) {
            Queue.getVillageByCoords(command.target, function (data) {
                if (data) {
                    return resolve(data)
                }

                reject('error.originNotExist')
            })
        })

        var loadVillagesData = Promise.all([
            getOriginVillage,
            getTargetVillage
        ])

        loadVillagesData.then(function (villages) {
            command.origin = villages[0]
            command.target = villages[1]
            command.units = cleanZeroUnits(command.units)
            command.date = fixDate(command.date)
            command.travelTime = Queue.getTravelTime(command.origin, command.target, command.units, command.type, command.officers)

            var inputTime = getTimeFromString(command.date)

            if (command.dateType === 'arrive') {
                command.sendTime = inputTime - command.travelTime
                command.arriveTime = inputTime
            } else {
                command.sendTime = inputTime
                command.arriveTime = inputTime + command.travelTime
            }

            console.log(new Date(command.arriveTime))

            if (isTimeToSend(command.sendTime)) {
                return Queue.trigger('error', [Locale('queue', 'error.alreadySent', {
                    date: formatDate(command.sendTime),
                    type: Locale('queue', command.type)
                })])
            }

            if (command.type === 'attack' && 'supporter' in command.officers) {
                delete command.officers.supporter
            }

            // Originalmente o jogo envia os oficiais por quantidade,
            // mesmo que seja sempre 1.
            for (var officer in command.officers) {
                command.officers[officer] = 1
            }

            // Define o alvo da catapulta apenas se houver alguma catapulta
            // na lista de unidades.
            if (!command.units.catapult || command.type === 'support') {
                command.catapultTarget = null
            }

            command.id = guid()

            pushWaitingCommand(command)
            pushCommandObject(command)
            sortWaitingQueue()
            storeWaitingQueue()

            Queue.trigger('add', [command])
        })

        loadVillagesData.catch(function (error) {
            Queue.trigger('error', [Locale('queue', error)])
        })
    }

    /**
     * Remove um comando da lista de espera.
     *
     * @param  {Object} command - Dados do comando a ser removido.
     * @param  {String} reason - Razão do comando ter sido removido. (expired/removed)
     */
    Queue.removeCommand = function (command, reason) {
        delete waitingCommandsObject[command.id]

        for (var i = 0; i < waitingCommands.length; i++) {
            if (waitingCommands[i].id == command.id) {
                waitingCommands.splice(i, 1)

                if (reason === 'expired') {
                    Queue.trigger('expired', [command])
                } else if (reason === 'removed') {
                    Queue.trigger('remove', [true, command, true /*manual*/])
                }

                return storeWaitingQueue()
            }
        }

        Queue.trigger('remove', [false])
    }

    /**
     * Remove todos os comandos já enviados e expirados da lista e do localStorage.
     */
    Queue.clearRegisters = function () {
        Lockr.set(worldPrefix('queue-expired'), [])
        Lockr.set(worldPrefix('queue-sended'), [])
        expiredCommands = []
        sendedCommands = []
    }

    /**
     * Ativa o CommandQueue. Qualquer comando que chegar no horário
     * de envio, será enviado.
     */
    Queue.start = function () {
        running = true
        Queue.trigger('start')
    }

    /**
     * Desativa o CommandQueue
     */
    Queue.stop = function () {
        running = false
        Queue.trigger('stop')
    }

    /**
     * Verifica se o CommandQueue está ativado.
     *
     * @return {Boolean}
     */
    Queue.isRunning = function () {
        return running
    }

    /**
     * Obtem lista de comandos ordenados na lista de espera.
     *
     * @return {Array}
     */
    Queue.getWaitingCommands = function () {
        return waitingCommands
    }

    /**
     * Obtem lista de comandos em espera.
     *
     * @return {Object}
     */
    Queue.getWaitingCommandsObject = function () {
        return waitingCommandsObject
    }

    /**
     * Obtem lista de comandos enviados;
     *
     * @return {Array}
     */
    Queue.getSendedCommands = function () {
        return sendedCommands
    }

    /**
     * Obtem lista de comandos expirados;
     *
     * @return {Array}
     */
    Queue.getExpiredCommands = function () {
        return expiredCommands
    }

    /**
     * Calcula o tempo de viagem de uma aldeia a outra
     *
     * @param {Object} origin - Objeto da aldeia origem.
     * @param {Object} target - Objeto da aldeia alvo.
     * @param {Object} units - Exercito usado no ataque como referência para calcular o tempo.
     * @param {String} type - Tipo de comando (attack,support,relocate)
     * @param {Object} officers - Oficiais usados no comando (usados para efeitos)
     *
     * @return {Number} Tempo de viagem
     */
    Queue.getTravelTime = function (origin, target, units, type, officers) {
        var useEffects = false
        var targetIsBarbarian = !target.character_id
        var targetIsSameTribe = target.character_id && target.tribe_id &&
            target.tribe_id === $player.getTribeId()

        if (type === 'attack') {
            if ('supporter' in officers) {
                delete officers.supporter
            }

            if (targetIsBarbarian) {
                useEffects = true
            }
        } else if (type === 'support') {
            if (targetIsSameTribe) {
                useEffects = true
            }

            if ('supporter' in officers) {
                useEffects = true
            }
        }

        var army = {
            units: units,
            officers: angular.copy(officers)
        }

        var travelTime = armyService.calculateTravelTime(army, {
            barbarian: targetIsBarbarian,
            ownTribe: targetIsSameTribe,
            officers: officers,
            effects: useEffects
        }, type)

        var distance = $math.actualDistance(origin, target)

        var totalTravelTime = armyService.getTravelTimeForDistance(
            army,
            travelTime,
            distance,
            type
        )

        return totalTravelTime * 1000
    }

    /**
     * Carrega os dados de uma aldeia pelas coordenadas.
     *
     * @param  {String} coords - Coordendas da aldeia.
     * @param  {Function} callback
     */
    Queue.getVillageByCoords = function (coords, callback) {
        var splitCoords = coords.split('|').map(function (coord) {
            return parseInt(coord, 10)
        })

        var x = splitCoords[0]
        var y = splitCoords[1]
        var loaded = $mapData.hasTownDataInChunk(x, y)

        if (!loaded) {
            return $mapData.loadTownDataAsync(x, y, 1, 1, function () {
                Queue.getVillageByCoords(coords, callback)
            })
        }

        var sectors = $mapData.loadTownData(x, y, 1, 1, $conf.MAP_CHUNK_SIZE)
        var sector = sectors[0].data
        var village = false

        if (sector[x] && sector[x][y]) {
            village = sector[x][y]
        }

        callback(village ? village : false)
    }

    /**
     * Filtra os comandos de acordo com o filtro especificado.
     *
     * @param  {String} filterId - Identificação do filtro.
     * @param {Array=} _options - Valores a serem passados para os filtros.
     * @param {Array=} _commandsDeepFilter - Usa os comandos passados pelo parâmetro
     *   ao invés da lista de comandos completa.
     * @return {Array} Comandos filtrados.
     */
    Queue.filterCommands = function (filterId, _options, _commandsDeepFilter) {
        var filterHandler = commandFilters[filterId]
        var commands = _commandsDeepFilter || waitingCommands

        return commands.filter(function (command) {
            return filterHandler(command, _options)
        })
    }

    return Queue
})
