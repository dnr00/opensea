import { ethers } from 'ethers';
import { FordefiWeb3Provider, FordefiProviderConfig, EvmChainId } from "@fordefi/web3-provider";
import { OpenSeaSDK, Chain, OrderSide } from 'opensea-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * 환경 변수 및 설정 값
 */
const NFT_CONTRACT_ADDRESS = '0xb5f58fe2fdd79b279bf2b201f91ba784b79c8744'; // NFT 컨트랙트 주소
const NFT_TOKEN_ID = '363077'; // NFT 토큰 ID
const WETH_CONTRACT_ADDRESS = '0x4200000000000000000000000000000000000006'; // Base의 WETH 주소
const SEAPORT_ADDRESS = '0x0000000000000068f116a894984e2db1123eb395'; // Seaport 컨트랙트 주소
const PEM_KEY_PATH = '/Users/sangwook/workspace/typescript/opensea/private.pem';

// WETH ABI (필요한 함수만 포함)
const WETH_ABI = [
  'function approve(address spender, uint256 amount) public returns (bool)',
  'function balanceOf(address account) public view returns (uint256)',
  'function allowance(address owner, address spender) public view returns (uint256)'
];

/**
 * Fordefi Provider 설정 및 초기화
 */
class FordefiProviderManager {
  provider: FordefiWeb3Provider;
  ethersProvider: ethers.BrowserProvider | ethers.JsonRpcProvider;
  signer: ethers.Signer;
  walletAddress: string;
  
  constructor() {
    const pemKey = fs.readFileSync(PEM_KEY_PATH, 'utf8') ?? 
      (() => { throw new Error('PEM 키를 읽을 수 없습니다') })();
    
    const config: FordefiProviderConfig = {
      chainId: EvmChainId.NUMBER_8453, // Base
      address: "0x2A7fb76E6EC0a3b329Ac3AB94dBdbAB2F0cC5c8e",
      apiUserToken: process.env.FORDEFI_API_USER_TOKEN!,
      apiPayloadSignKey: pemKey,
      rpcUrl: "https://base-mainnet.g.alchemy.com/v2/sA2ayOK8MT4fMosd38djWYYseUK8toHM"
    };
    
    this.walletAddress = config.address;
    this.provider = new FordefiWeb3Provider(config);
    
    // ethers v6 변경사항 반영
    this.ethersProvider = new ethers.BrowserProvider(this.provider as any);
    this.signer = this.ethersProvider.getSigner() as unknown as ethers.Signer;
  }
  
  /**
   * EIP-1193 이벤트 등록 및 Provider 연결
   */
  async connect() {
    // 이벤트 리스너 등록
    this.provider.on('connect', (connectInfo: { chainId: string }) => {
      console.log(`Provider 연결됨, 체인 ID: ${connectInfo.chainId}`);
    });
    
    this.provider.on('disconnect', (error: { code: number; message: string }) => {
      console.error(`Provider 연결 해제됨: ${error.message}`);
    });
    
    this.provider.on('chainChanged', (chainId: string) => {
      console.log(`체인 변경됨: ${chainId}`);
    });
    
    this.provider.on('accountsChanged', (accounts: string[]) => {
      console.log(`계정 변경됨: ${accounts.join(', ')}`);
    });
    
    // Provider 연결
    console.log("Fordefi Provider에 연결 중...");
    await this.provider.connect();
    console.log("Fordefi Provider에 성공적으로 연결됨");
    
    // ethers v6에서는 getSigner()가 Promise를 반환
    this.signer = await this.ethersProvider.getSigner();
    const address = await this.signer.getAddress();
    console.log(`사용 중인 지갑 주소: ${address}`);
    
    return this.signer;
  }
  
  /**
   * Provider 연결 해제
   */
  async disconnect() {
    await this.provider.disconnect();
    console.log("Fordefi Provider 연결 해제됨");
  }
}

/**
 * OpenSea NFT 거래 관리 클래스
 */
class OpenSeaNFTBuyer {
  openseaSDK: OpenSeaSDK;
  signer: ethers.Signer;
  walletAddress: string;
  
  constructor(signer: ethers.Signer, walletAddress: string) {
    this.signer = signer;
    this.walletAddress = walletAddress;
    
    // OpenSea SDK 초기화
    this.openseaSDK = new OpenSeaSDK(signer as any, {
      chain: Chain.Base,
      apiKey: process.env.OPENSEA_API_KEY!,
    });
  }
  
  /**
   * NFT 판매 주문 조회
   */
  async findListingOrder(contractAddress: string, tokenId: string) {
    console.log(`${contractAddress}의 토큰 ID ${tokenId} 판매 주문 조회 중...`);
    
    const { orders } = await this.openseaSDK.api.getOrders({
      assetContractAddress: contractAddress,
      tokenId,
      side: OrderSide.LISTING
    });
    
    if (!orders || orders.length === 0) {
      console.log('판매 중인 NFT를 찾을 수 없습니다');
      return null;
    }
    
    const order = orders[0];
    console.log('판매 주문 찾음:', order);
    return order;
  }
  
  /**
   * WETH 잔액 및 승인 확인
   */
  async checkAndApproveWETH(orderPrice: bigint) {
    const wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, WETH_ABI, this.signer);
    
    // WETH 잔액 확인
    const wethBalance = await wethContract.balanceOf(this.walletAddress);
    console.log(`WETH 잔액: ${ethers.formatEther(wethBalance)} WETH`);
    console.log(`필요한 금액: ${ethers.formatEther(orderPrice)} WETH`);
    
    if (wethBalance < orderPrice) {
      throw new Error(`WETH 잔액이 부족합니다. ${ethers.formatEther(orderPrice)} WETH가 필요하지만, ${ethers.formatEther(wethBalance)} WETH만 보유하고 있습니다.`);
    }
    
    // WETH 승인 확인
    const allowance = await wethContract.allowance(this.walletAddress, SEAPORT_ADDRESS);
    
    if (allowance < orderPrice) {
      console.log('WETH 승인 중...');
      const approveTx = await wethContract.approve(SEAPORT_ADDRESS, orderPrice);
      await approveTx.wait();
      console.log('WETH 승인 완료');
    } else {
      console.log('이미 충분한 WETH가 승인되었습니다');
    }
    
    return true;
  }
  
  /**
   * NFT 구매 실행
   */
  async fulfillOrder(order: any) {
    console.log('주문 실행 중...');
    const fulfillment = await this.openseaSDK.fulfillOrder({
      order,
      accountAddress: this.walletAddress
    });
    
    console.log('주문 실행 완료!', fulfillment);
    return fulfillment;
  }
}

/**
 * 메인 함수: NFT 구매 프로세스
 */
async function buyNFT() {
  const fordefiManager = new FordefiProviderManager();
  
  try {
    // 1. Fordefi Provider 연결
    const signer = await fordefiManager.connect();
    
    // 2. OpenSea Buyer 초기화
    const buyer = new OpenSeaNFTBuyer(signer, fordefiManager.walletAddress);
    
    // 3. NFT 판매 주문 조회
    const order = await buyer.findListingOrder(NFT_CONTRACT_ADDRESS, NFT_TOKEN_ID);
    if (!order) return;
    
    // 4. WETH 잔액 및 승인 확인
    await buyer.checkAndApproveWETH(order.currentPrice);
    
    // 5. NFT 구매 실행
    await buyer.fulfillOrder(order);
    
    console.log('NFT 구매가 성공적으로 완료되었습니다!');
  } catch (error: any) {
    // 오류 처리
    if (error?.message?.includes('balances needed')) {
      console.error('잔액 또는 승인 오류:', error.message);
      console.log('다음을 확인해보세요:');
      console.log('1. WETH 잔액이 충분한지');
      console.log('2. WETH 승인이 되어있는지');
      console.log('3. 판매자가 ETH로 판매하는지 WETH로 판매하는지');
    } else {
      console.error('오류 발생:', error.message || error);
    }
  } finally {
    // 항상 Provider 연결 해제
    await fordefiManager.disconnect();
  }
}

// 구매 함수 실행
buyNFT();
