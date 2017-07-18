/**
 * Command Queue for Tribal Wars 2
 * 
 * Rafael Mafra <mafrazzrafael@gmail.com>
 *
 * 06/2016
 */

require([
    'conf/unitTypes',
    'helper/time',
    'helper/math'
], function (UNITS, $timeHelper, $math) {
    if (typeof planeador !== 'undefined') {
        return false
    }

    var $rootScope = angular.element(document).scope()
    let $model = injector.get('modelDataService')
    var $armyService = injector.get('armyService')
    var $routeProvider = injector.get('routeProvider')
    var $socket = injector.get('socketService')
    var $autoCompleteService = injector.get('autoCompleteService')
    var $officers = $model.getGameData().getOrderedOfficerNames()
    
    var $filter = injector.get('$filter')
    var $i18n = $filter('i18n')
    var readableMillisecondsFilter = $filter('readableMillisecondsFilter')
    var readableDateFilter = $filter('readableDateFilter')

    var commandQueue = []
    var queueIndex = 1
    var hooks = {}
    var plugins = {
        coords: {}
    }

    function joinTroopsLog (units) {
        var troops = []

        for (unit in units) {
            troops.push(`${unit}: ${units[unit]}`)
        }

        return troops.join(',')
    }

    function joinOfficersLog (officers) {
        var string = []

        for (var officer in officers) {
            string.push(officer)
        }

        return string.join(', ')
    }

    function updateVillageData (coords, originalObject, prop) {
        coords = coords.split('|').map(function (coord) {
            return parseInt(coord, 10)
        })

        $autoCompleteService.villageByCoordinates({
            x: coords[0],
            y: coords[1]
        }, function (villageData) {
            originalObject[prop].id = villageData.id
            originalObject[prop].name = villageData.name
        })
    }

    function orderQueue () {
        commandQueue = commandQueue.sort(function (a, b) {
            return a.sendTime - b.sendTime
        })
    }

    function getTravelTime (origin, target, units, type, officers) {
        var army = {
            units: units,
            officers: officers
        }

        var travelTime = $armyService.calculateTravelTime(army, {
            barbarian: true,
            ownTribe: true,
            officers: officers,
            effects: false
        })

        origin = origin.split('|')
        target = target.split('|')

        let distance = $math.actualDistance({
            x: origin[0],
            y: origin[1]
        }, {
            x: target[0],
            y: target[1]
        })

        let totalTravelTime = $armyService.getTravelTimeForDistance(
            army,
            travelTime,
            distance,
            type
        )

        return totalTravelTime * 1000
    }

    function sendCommand (command) {
        $socket.emit($routeProvider.SEND_CUSTOM_ARMY, {
            start_village: command.origin.id,
            target_village: command.target.id,
            type: command.type,
            units: command.units,
            icon: 0,
            officers: command.officers,
            catapult_target: null
        })
        
        console.log('============= planeador =============')
        console.log('ataque #' + command.id + ' enviado')

        console.log({
            start_village: command.origin.id,
            target_village: command.target.id,
            type: command.type,
            units: command.units,
            icon: 0,
            officers: command.officers,
            catapult_target: null
        })
    }

    function checkParams (origin, target, units, arrive) {
        if (!checkCoords(origin)) {
            console.error('Origin coords format', origin, 'is invalid!')
            console.error('Must be xxx|yyy')
            return false
        }

        if (!checkCoords(target)) {
            console.error('Target coords format', origin, 'is invalid!')
            console.error('Must be xxx|yyy')
            return false
        }

        if (!units) {
            console.error('Units not specified')
            return false
        }

        for (var unit in units) {
            if (!UNITS.hasOwnProperty(unit.toUpperCase())) {
                console.error('Unit ' + unit + ' is invalid!')
                return false
            }

            if (units[unit] == 0) {
                console.error('Unit amount can not be ZERO!')
                return false
            }
        }

        // if (typeof arrive !== 'string') {
        //     console.error('Date format ' + arrive + ' is invalid!')
        //     return false
        // }

        return true
    }

    function checkCoords (xy) {
        return /\d{3}\|\d{3}/.test(xy)
    }

    function listUnitsHelp () {
        var unitList = []

        for (var unit in UNITS) {
            unitList.push(UNITS[unit] + ' ------------ (' + $i18n(UNITS[unit], $rootScope.loc.ale, 'unit_names') + ')')
        }

        return unitList.join('\n')
    }

    function listOfficersHelp () {
        var officerList = []

        $officers.map(function (officer) {
            officerList.push(
                "'" + officer + "' ------------ (" + $i18n(officer, $rootScope.loc.ale, 'officer_names') + ')'
            )
        })

        return officerList.join('\n')
    }

    function pluginScan (type, string) {
        var _plugins = plugins[type]

        for (var id in _plugins) {
            string = string.replace(id, function () {
                return _plugins[id].call()
            })
        }

        return string
    }

    console.log('%c======== PLANEADOR INICIADO ========', 'color:blue')
    console.log('digite planeador.ajuda()')

    plugins.coords.selecionada = function () {
        var village = $model.getSelectedVillage()

        return village.getX() + '|' + village.getY()
    }

    plugins.coords.mouse = function () {
        var $villageName = $('#map-tooltip .village-name')

        if (!$villageName.isVisible()) {
            console.error('Nenhum alvo com mouse em cima no mapa!')
            return false
        }

        var coords = $villageName.html().match(/\((\d+) \| (\d+)\)/)

        return coords[1] + '|' + coords[2]
    }

    hooks.add = function add (origin, target, units, arrive, type, officers) {
        type = type || 'attack'
        officers = officers || []

        origin = pluginScan('coords', origin)
        target = pluginScan('coords', target)

        if (!origin || !target) {
            throw new Error('Origem/alvo contem erros.')
        }

        if (!checkParams(origin, target, units, arrive)) {
            return false
        }

        var arriveTime = new Date(arrive).getTime()
        var travelTime = getTravelTime(origin, target, units, type)
        var sendTime = arriveTime - travelTime

        if ($timeHelper.gameTime() > sendTime) {
            console.log(origin, target, units)
            console.error('Erro! Esse comando já deveria ter saído!')
            console.error('Origem:', origin, 'Alvo:', target)
            console.error('Chegada:', arrive, 'Tempo de viagem:', readableMillisecondsFilter(travelTime))
            return false
        }

        var objOfficers = {}
        
        officers.map(function (officer) {
            if (!$officers.includes(officer)) {
                throw new Error('Oficial "' + officer + '" não exite!')
            }

            objOfficers[officer] = 1
        })

        var commandData = {
            id: queueIndex,
            sendTime: sendTime,
            units: units,
            travelTime: travelTime,
            officers: objOfficers,
            origin: { coords: origin, name: null, id: null },
            target: { coords: target, name: null, id: null },
            type: type || 'attack'
        }

        commandQueue.push(commandData)

        updateVillageData(origin, commandData, 'origin')
        updateVillageData(target, commandData, 'target')

        planeador.listar(queueIndex)

        orderQueue()
        queueIndex++
    }

    hooks.ajuda = function ajuda () {
        console.log(`%c===================== planeador.add ======================`, 'background:#ccc')
        console.log(`%cplaneador.add( origem, alvo, unidades, data_chegada, tipo, oficiais )`, 'color:#000')
        console.log(`origem ---------- "xxx|yyy" coordenadas da aldeia que vai atacar`)
        console.log(`alvo ------------ "xxx|yyy" coordenadas da aldeia alvo`)
        console.log(`unidades -------- { nome: quantidade, nome: quantidade }`)
        console.log(`data_chegada ---- "hora:minuto:segundo:milesimos mes/dia/ano"`)
        console.log(`tipo ------------ "attack" ou "support" (ataque/apoio)`)
        console.log(`oficiais -------- [ 'leader', 'medic' ]`)
        console.log('')
        console.log(`// exemplo`)
        console.log(`planeador.add('500|500', '600|600', {`)
        console.log(`   spear: 100,`)
        console.log(`   axe: 100,`)
        console.log(`   archer: 100`)
        console.log(`}, '06:30:00:999 12/30/2017', 'attack')`)
        console.log('')
        console.log(`// lista de unidades`)
        console.log(`${listUnitsHelp()}`)
        console.log('')
        console.log(`// lista de oficiais`)
        console.log(`${listOfficersHelp()}`)
        console.log('')
        console.log(`%c==================== planeador.remove ====================`, 'background:#ccc')
        console.log(`%cplaneador.remove( identificação )`, 'color:#000')
        console.log(`identificação --- número do comando gerado no .add()`)
        console.log('')
        console.log(`%c==================== planeador.listar ====================`, 'background:#ccc')
        console.log(`%cplaneador.listar()`, 'color:#000')
        console.log(`// lista todos os ataques do planeado`)
    }

    hooks.listar = function listar (_id) {
        var gameTime = $timeHelper.gameTime()

        // var commandsTable = {}

        for (var i = 0; i < commandQueue.length; i++) {
            var cmd = commandQueue[i]

            if (_id && _id != cmd.id) {
                continue
            }
            
            var troops = joinTroopsLog(cmd.units)
            var officers = joinOfficersLog(cmd.officers)
            var $travelTime = readableMillisecondsFilter(cmd.travelTime)
            var $sendTime = readableDateFilter(cmd.sendTime)
            var $arrive = readableDateFilter(cmd.sendTime + cmd.travelTime)
            var $remain = readableMillisecondsFilter(cmd.sendTime - gameTime)

            console.log(`%c============= planeador.listar #${cmd.id} =============`, 'background:#ccc')
            console.log(`Identificação:  ${cmd.id}`)
            console.log(`Saida em:       ${$remain}`)
            console.log(`Duração:        ${$travelTime}`)
            console.log(`Envio:          ${$sendTime}`)
            console.log(`Chegada:        ${$arrive}`)
            console.log(`Origem:         ${cmd.origin.name} (${cmd.origin.coords})`)
            console.log(`Alvo:           ${cmd.target.name} (${cmd.target.coords})`)
            console.log(`Tropas:         ${troops}`)
            console.log(`Oficiais:       ${officers}`)
            console.log(`Tipo:           ${cmd.type}`)

            // commandsTable[cmd.id] = {
            //     'Saida em': $remain,
            //     'Duração': $travelTime,
            //     'Envio': $sendTime,
            //     'Chegada': $arrive,
            //     'Origem': `${cmd.target.name} (${cmd.target.coords})`,
            //     'Alvo': `${cmd.target.name} (${cmd.target.coords})`,
            //     'Tropas': troops,
            //     'Oficiais': officers,
            //     'Tipo': cmd.type
            // }
        }

        // console.table(commandsTable)
    }

    hooks.remove = function remove (id) {
        console.log('%c============= planeador.remove =============', 'background:#ccc')

        for (var i = 0; i < commandQueue.length; i++) {
            if (commandQueue[i].id == id) {
                console.log('ataque #' + id + ' removido!')
                
                commandQueue.splice(i, i + 1)
                return
            }
        }

        console.log('nenhum ataque removido!')
    }

    function listener () {
        setInterval(function () {
            var gameTime = $timeHelper.gameTime()
            var command
            var i

            if (!commandQueue.length) {
                return false
            }

            for (i = 0; i < commandQueue.length; i++) {
                if (commandQueue[i].sendTime - gameTime < 0) {
                    sendCommand(commandQueue[i])
                } else {
                    break
                }
            }

            if (i) {
                commandQueue.splice(0, i)
            }
        }, 150)
    }

    window.onbeforeunload = function () {
        if (commandQueue.length) {    
            return true
        }
    }

    listener()

    window.planeador = hooks
})
