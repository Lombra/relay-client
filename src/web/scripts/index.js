import Relay from 'relay'
import { createApp } from 'vue'
import { Dialog, DialogButton } from 'modal'
import PanelContainer, { AssetError } from 'panel'
import View from 'view'
import ButtonControl from 'controls/button'
import SliderControl from 'controls/slider'
import { TextLabel, IconLabel, ImageLabel } from 'label'

let relay = new Relay()

customElements.define('panel-container', PanelContainer)
customElements.define('panel-view', View)
customElements.define('button-control', ButtonControl)
customElements.define('slider-control', SliderControl)
customElements.define('text-label', TextLabel)
customElements.define('icon-label', IconLabel)
customElements.define('image-label', ImageLabel)

let panel = document.createElement('panel-container')

const PanelApp = {
	data: () => ({
		dialogs: {
			connect: { show: false },
			alert: { show: false },
			reconnecting: { show: false },
		},
		address: '',
		port: 32155,
		currentServer: '',
		panels: [],
		currentPanel: null,
		connectionState: Relay.ConnectionState.Disconnected,
	}),

	computed: {
		connected() {
			return this.connectionState === Relay.ConnectionState.Connected
		},

		connecting() {
			return this.connectionState === Relay.ConnectionState.Connecting
		},
	},

	methods: {
		async submit() {
			localStorage.setItem('address', this.address)
			localStorage.setItem('port', this.port)

			await this.connect(this.address, this.port)
			this.dialogs.connect.show = false
		},

		async connect(address, port) {
			try {
				let promiseConnect = relay.connect(address, port)
				this.connectionState = relay.connectionState
				await promiseConnect
			} catch (err) {
				this.showAlertDialog("Connection error", [`Unable to connect to server ${address}:${port}.`, err.message])
				this.dialogs.alert.connectAfterClose = true
				return
			} finally {
				this.connectionState = relay.connectionState
			}
			await this.updatePanels()
			this.currentServer = relay.address

			let lastPanel = localStorage.getItem('lastPanel')
			if (lastPanel) {
				this.loadPanel(lastPanel)
			}
		},

		async updatePanels() {
			let panels = await relay.getPanels()
			this.panels = panels
		},

		async loadPanel(panelName) {
			// if (panelName !== currentPanel) {
				panel.removeViews()
			// }

			let panelData = null
			try {
				panelData = await relay.getPanel(panelName)
			} catch (err) {
				let message = []
				if (err instanceof SyntaxError) {
					message.push(`Error on line ${err.lineNumber} at column ${err.columnNumber}:`)
				}
				message.push(err.message)
				this.showAlertDialog('Failed to load panel', message)
				return
			}

			this.currentPanel = panelName
			localStorage.setItem('lastPanel', panelName)

			try {
				await panel.build(panelData)
			} catch (err) {
				let errors = []
				errors.push(err.message)
				if (err instanceof AssetError) {
					errors = errors.concat(err.errors)
				}
				this.showAlertDialog(`Failed to load panel`, errors)
				this.closePanel()
				return
			}

			// request devices
			let devices = await this.acquireDevices()
			let warnings = []
			for (let { value: device } of devices) {
				if (!device.isAcquired) {
					warnings.push(`Unable to acquire device ${device.id}`)
				} else {
					let requestedDevice = panel.usedDeviceResources[device.id]
					if (requestedDevice.buttons > device.numButtons) {
						warnings.push(`Device ${device.id} has ${device.numButtons} buttons but this panel uses ${requestedDevice.buttons}`)
					}
					if (requestedDevice.axes) {
						for (let axis of requestedDevice.axes) {
							if (!device.axes[axis]) {
								warnings.push(`Requested axis ${axis} not enabled on device ${device.id}`)
							}
						}
					}
				}
			}
			if (warnings.length > 0) {
				this.showAlertDialog("Device info", warnings)
			}
		},

		acquireDevices() {
			return Promise.allSettled(Object.keys(panel.usedDeviceResources).map(e => relay.acquireDevice(parseInt(e))))
		},

		closePanel() {
			this.currentPanel = null
			localStorage.removeItem('lastPanel')
			panel.style.display = 'none'
		},

		reconnectingDialogClose() {
			this.dialogs.reconnecting.show = false
			this.dialogs.reconnecting.cancelled = true
			relay.disconnect()
		},

		showAlertDialog(title, message) {
			this.dialogs.alert.title = title
			this.dialogs.alert.message = message
			this.dialogs.alert.show = true
		},

		alertDialogClose(event) {
			this.dialogs.alert.show = false
			if (this.dialogs.alert.connectAfterClose) this.dialogs.connect.show = true
			this.dialogs.alert.connectAfterClose = false
		},

		async sendInput(input) {
			let res = await relay.sendInput(input)
			if (!res.ok) {
				this.showAlertDialog("Input error", ["Error sending input.", res.message])
			}
		},

		onButtonChange(e) {
			let action = e.detail
			switch (action.type) {
				case Relay.InputType.macro:
					if (action.isPressed) return
					break
				case Relay.InputType.command:
					if (action.isPressed) return
					break
				case Relay.InputType.view:
					if (!action.isPressed) panel.setView(action.view)
					return
			}
			this.sendInput(action)
		},

		onSliderChange(e) {
			this.sendInput(e.detail)
		},
	},

	async created() {
		if (localStorage.getItem('address')) {
			this.address = localStorage.getItem('address')
			this.port = localStorage.getItem('port')

			this.connect(this.address, this.port)
		} else {
			this.showConnectDialog = true
		}

		window.getAssetPath = (file) => relay.getAssetPath(this.currentPanel, file)
		window.closePanel = () => this.closePanel()

		relay.addEventListener('reconnecting', e => {
			this.connectionState = relay.connectionState
			this.dialogs.reconnecting.show = true
			this.dialogs.reconnecting.cancelled = false
		})

		relay.addEventListener('reconnected', e => {
			this.connectionState = relay.connectionState
			this.dialogs.reconnecting.show = false
			this.acquireDevices()
		})

		relay.addEventListener('close', e => {
			this.connectionState = relay.connectionState
			this.closePanel()
			this.dialogs.reconnecting.show = false
			if (!this.dialogs.reconnecting.cancelled) {
				this.dialogs.reconnecting.cancelled = false
				this.showAlertDialog("Connection error", ["Server connection lost.", e.detail?.message])
				this.dialogs.alert.connectAfterClose = true
			}
		})

		document.getElementById('app').appendChild(panel)

		panel.addEventListener('button-change', this.onButtonChange)
		panel.addEventListener('slider-change', this.onSliderChange)

		window.addEventListener('keydown', e => {
			if (e.code === 'Escape' || e.code === 'Backspace') {
				this.closePanel()
			}
		})
	},

	components: {
		'modal-dialog': Dialog,
		'dialog-button': DialogButton,
	},
}

let app = createApp(PanelApp)

app.mount('#app')
