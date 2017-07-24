require([
    'TWOverflow/ready',
    'TWOverflow/Queue',
    'TWOverflow/Queue/interface',
    'TWOverflow/Queue/analytics'
], function (
    ready,
    Queue
) {
    if (Queue.initialized) {
        return false
    }

    ready(function () {
        Queue.init()
        Queue.interface()
        Queue.analytics()
    })
})
