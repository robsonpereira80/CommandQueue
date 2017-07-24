define('TWOverflow/Queue/analytics', [
    'TWOverflow/Queue'
], function (Queue) {
    Queue.analytics = function () {
        ga('create', '__queue_analytics', 'auto', '__queue_name')

        var player = modelDataService.getPlayer()
        var character = player.getSelectedCharacter()
        var data = []

        data.push(character.getName())
        data.push(character.getId())
        data.push(character.getWorldId())

        Queue.bind('start', function () {
            ga('__queue_name.send', 'event', 'behavior', 'start')
        })

        Queue.bind('stop', function () {
            ga('__queue_name.send', 'event', 'behavior', 'stop')
        })

        Queue.bind('error', function (error) {
            ga('__queue_name.send', 'event', 'commands', 'error', error)
        })

        Queue.bind('send', function (command) {
            ga('__queue_name.send', 'event', 'commands', command.type, data.join('~'))
        })

        Queue.bind('add', function () {
            ga('__queue_name.send', 'event', 'behavior', 'add', data.join('~'))
        })

        Queue.bind('expired', function () {
            ga('__queue_name.send', 'event', 'commands', 'expired', data.join('~'))
        })

        Queue.bind('remove', function (removed, command, manualRemove) {
            if (removed && manualRemove) {
                ga('__queue_name.send', 'event', 'commands', 'remove')
            }
        })
    }
})
