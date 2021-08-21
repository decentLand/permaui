/*
 * SPDX-License-Identifier:    MIT
 */


export async function handle (state, action) {

	const caller = action.caller
	const input = action.input
	const balances = state.balances
	const proposals = state.proposals

	// convication-related constants
	const PADD = 10;
	const TIME_UNIT = 1;
	const CONV_ALPHA = 90;


	// Errors list:

	// Wallet's state realtes errors: Balance, Address, TXs
	const ERROR_INVALID_ARWEAVE_ADDRESS = `The supplied string is an invalid Arweave address`;
	const ERROR_INVALID_ARWEAVE_TXID = `The supplied string is an invalid Arweave TX`;
	const ERROR_CALLER_NOT_FOUND = `caller is not found in the balances`;
	const ERROR_UNSUFFICIENT_BALANCE = `caller has unsufficient token's (PST) balance`;
	const ERROR_INVALID_TOKEN_QTY_TRANSFER = `PST quantity must be a positive, non-zero Integer`;
	// Data Types errors
	const ERROR_INVALID_NUMBER_TYPE = `numbers must be supplied as integer only`;
	const ERROR_INVALID_STRING = `the supplied input (argument) is not a String`;
	const ERROR_INVALID_URL = `the supplied string is not a valid URL`;
	const ERROR_NEGATIVE_INTEGER = `only positive integers are allowed`;
	// TX tags erros
	const ERROR_MIME_TYPE = `an invalid mime type has been passed`;
	const ERROR_MISSING_TAG = `missing a required TX tag`;
	// Proposal related
	const ERROR_INVALID_PROPOSAL_ID = `the supplied id (index) does not exist`;
	const ERROR_STAKER_NOT_FOUND = `the caller is not a recognized staker in the proposal`;
	const ERROR_REQUIRED_ARGUMENT = `missing a function's required argument`;
	const ERROR_UNPERMISSIONED_CALLER = `the caller does not has the persmission to execute this function`
	const ERROR_PROPOSAL_ALREADY_CANCELED = `the proposal status is already set to canceled`

	const proposalStatus = {
		Active: "active", 	   	// the propsal has been added to the state
		Canceled: "canceled", 	// proposal's owner (proposer) cancel it
		Executed: "executed" 	// the proposal takes effect (finalized & passed)
	};



	if (input.function === "name") {
		const name = state.name

		return { result: { name } }
	}

	if (input.function === "ticker") {
		const ticker = state.ticker

		return { result: { ticker } }
	}

	if (input.function === "totalSupply") {
		const totalSupply = state.totalSupply

		return { result: { totalSupply } }
	}

	if (input.function === "balanceOf") {
		const address = input.address

		if (typeof address !== "string" || address.length !== 43) {
			throw new ContractError(ERROR_INVALID_ARWEAVE_ADDRESS)
		}

		const balance = balances[caller] ? balances[caller] : 0

		return { result: { balance } }
	}

	if (input.function === "transfer") {
		const from = caller
		const to = input.to
		const qty = input.qty

		if ( ! balances[caller] ) {
			throw new ContractError(ERROR_CALLER_NOT_FOUND)
		}

		if ( ( balances[caller] <= 0 ) || ( ! Number.isInteger(qty) ) ) { 
			throw new ContractError(ERROR_INVALID_TOKEN_QTY_TRANSFER)
		}

		if ( balances[caller] < qty ) {
			throw new ContractError(ERROR_UNSUFFICIENT_BALANCE)
		}

		if (typeof to !== "string" || to.length !== 43) {
			throw new ContractError(ERROR_INVALID_ARWEAVE_ADDRESS)
		}

		if ( ! balances[to] ) {
			balances[to] = 0
		}

		balances[to] += qty
		balances[caller] -= qty

		return { state }

	}

	if (input.function === "addProposal") {
		const name = input.name
		const version = input.version
		const url = input.url
		const txid = input.txid


		const blockheight = SmartWeave.block.height
		const tagsMap = new Map()

		if ( ! balances[caller] ) {
			throw new ContractError(ERROR_CALLER_NOT_FOUND)
		}

		if (balances[caller] === 0) {
			throw new ContractError(ERROR_UNSUFFICIENT_BALANCE)
		}

		if ( typeof name !== "string" || name.length > 25) {
			throw new ContractError(ERROR_INVALID_STRING)
		}

		if (typeof version !== "string") {
			throw new ContractError(ERROR_INVALID_STRING)
		}

		if (typeof url !== "string") {
			throw new ContractError(ERROR_INVALID_STRING)
		}

		if (! url.startsWith("https://") ) {
			throw new ContractError(ERROR_INVALID_URL)
		}

		if (typeof txid !== "string" || txid.length !== 43) {
			throw new ContractError(ERROR_INVALID_ARWEAVE_TXID)
		}

		const txObject = await SmartWeave.unsafeClient.transactions.get(txid)
		const tags = txObject.get("tags")

		for (let tag of tags) {
			const key = tag.get("name", {decode: true, string: true})
			const value = tag.get("value", {decode: true, string: true})
			tagsMap.set(key, value)
		}

		if (! tagsMap.has("Content-Type") ) {
			throw new ContractError(ERROR_MISSING_TAG)
		}

		if (tagsMap.get("Content-Type") !== "application/x.arweave-manifest+json") {
			throw new ContractError(ERROR_MIME_TYPE)
		}

		state.proposals.push({
			// proposal's content which may
			// get executed if the proposal
			// is passed (finalized), thus, 
			// points a sub-domain to the
			// active, elected-permaUI
			pid: SmartWeave.transaction.id,
			name: name,
			permaUI: txid,
			url: url,
			version: version,
			proposer: caller,
			settings: {
				// vote's metadata and conviction settings 
				staked_tokens: 0,
				conviction_last: 0,
				block_last: 0,
				status: proposalStatus.Active,
				stakes_per_voter: {}
			}
		});

		state.proposal_counter += 1

		return { state }
	}

	if (input.function === "stakeToProposal") {
		const id = input.id 
		const qty = input.qty

		_validateInteger(id, true);
		_validateInteger(qty, false);

		if (! proposals[id] ) {
			throw new ContractError(ERROR_INVALID_PROPOSAL_ID)
		}

		if (! balances[caller]) {
			throw new ContractError(ERROR_CALLER_NOT_FOUND)
		}

		if (qty > balances[caller]) {
			throw new ContractError(ERROR_UNSUFFICIENT_BALANCE)
		}

		const proposal = proposals[id]["settings"]
		const old_staked = proposal.staked_tokens

		proposal.staked_tokens += qty
		
		// if the caller is an all new staker for the proposals.id,
		// initialize its  wallet address in the `stakes_per_voters` array
		if ( ! proposal.stakes_per_voter[caller] ) {
			proposal.stakes_per_voter[caller] = 0
		}

		proposal.stakes_per_voter[caller] += qty
		balances[caller] -= qty

		if (proposal.block_last === 0) {
			proposal.block_last = SmartWeave.block.height - TIME_UNIT
		}

		// calculateConviction argumentens
		const time_passed = SmartWeave.block.height - proposal.block_last
		const last_conv = proposal.conviction_last
		// old_amount is passed as old_staked
		const new_amount = proposal.staked_tokens

		const conviction = _calculateConviction(time_passed, last_conv, old_staked, new_amount)
		// update proposal's block and convication
		proposal.block_last = SmartWeave.block.height
		proposal.conviction_last = conviction

		return { state }

	}

	if (input.function === "unstakeFromProposal") {

		const id = input.id 	// proposal id
		const qty = input.qty 	// token's amount to unstake

    	_validateInteger(id, true);
    	_validateInteger(qty, false);

    	if (! balances[caller] ) {
    		throw new ContractError(ERROR_CALLER_NOT_FOUND)
    	}

    	if (! proposals[id]) {
    		throw new ContractError(ERROR_INVALID_PROPOSAL_ID)
    	}

    	const proposal = proposals[id]["settings"]

    	if ( ! proposal.stakes_per_voter[caller] ) {
    		throw new ContractError(ERROR_STAKER_NOT_FOUND)
    	}

    	const staked_tokens_by_caller = proposal.stakes_per_voter[caller]

    	if (staked_tokens_by_caller < qty) {
    		throw new ContractError(ERROR_UNSUFFICIENT_BALANCE)
    	}

    	const old_staked = proposal.staked_tokens

    	proposal.staked_tokens -= qty
    	proposal.stakes_per_voter[caller] -= qty
    	balances[caller] += qty 


		// `calculateConviction`` argumentens
		const time_passed = SmartWeave.block.height - proposal.block_last
		const last_conv = proposal.conviction_last
		// old_amount is passed as old_staked
		const new_amount = proposal.staked_tokens

		const conviction = _calculateConviction(time_passed, last_conv, old_staked, new_amount)
		// update proposal's block and convication
		proposal.block_last = SmartWeave.block.height
		proposal.conviction_last = conviction

		return { state }
	}

	if (input.function === "cancelProposal") {
		const id = input.id 

		_validateInteger(id, true)

		if (! proposals[id]) {
			throw new ContractError(ERROR_INVALID_PROPOSAL_ID)
		}

		const proposal = proposals[id]

		if (caller !== proposal["proposer"]) {
			throw new ContractError(ERROR_UNPERMISSIONED_CALLER)
		}

		if (proposal["status"] === "canceled") {
			throw new ContractError(ERROR_PROPOSAL_ALREADY_CANCELED)

		}

		proposal["status"] = proposalStatus.Canceled

		return { state }
	}

	if (input.function === "getProposal") {
		const id = input.id

		_validateInteger(id, true);

		if (! proposals[id]) {
			throw new ContractError(ERROR_INVALID_PROPOSAL_ID)
		}

		return { result: { proposals[id] } }

	}


	// HELPER FUNCTIONS:


    function _calculateConviction(time_passed, last_conv, old_amount, new_amount) {
        let steps = time_passed
        let conviction = last_conv;

        for (let i = 0; i < steps - 1; i++) {
            let conv = CONV_ALPHA * conviction / PADD / 10 + old_amount;
            conviction = conv
        }

        let final_conviction = CONV_ALPHA * conviction / PADD / 10 + new_amount;
        return final_conviction;
    }

	function _validateInteger(number, allowNull) {

		if ( typeof allowNull === "undefined" ) {
			throw new ContractError(ERROR_REQUIRED_ARGUMENT)
		}

		if (! Number.isInteger(number) ) {
			throw new ContractError(ERROR_INVALID_NUMBER_TYPE)
		}

		if (allowNull) {
			if (number < 0) {
				throw new ContractError(ERROR_NEGATIVE_INTEGER)
			}
		} else if (number <= 0) {
			throw new ContractError(ERROR_INVALID_NUMBER_TYPE)
		}
	}


}


