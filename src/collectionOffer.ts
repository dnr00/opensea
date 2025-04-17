import { ethers } from 'ethers';
import { FordefiWeb3Provider, FordefiProviderConfig, EvmChainId } from "@fordefi/web3-provider";
import { OpenSeaSDK, Chain } from 'opensea-js';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

/**
 * 환경 변수 및 설정 값
 */
const COLLECTION_SLUG = 'superfrensbysuperform'; // 오퍼를 넣을 컬렉션 슬러그
const OFFER_PRICE = '0.0001'; // 오퍼 가격 (WETH)
const OFFER_DURATION_HOURS = 24; // 오퍼 유효 시간 (시간)
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
 * OpenSea NFT 오퍼 관리 클래스
 */
class OpenSeaOfferManager {
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
   * WETH 잔액 및 승인 확인
   */
  async checkAndApproveWETH(offerPrice: bigint) {
    const wethContract = new ethers.Contract(WETH_CONTRACT_ADDRESS, WETH_ABI, this.signer);
    
    // WETH 잔액 확인
    const wethBalance = await wethContract.balanceOf(this.walletAddress);
    console.log(`WETH 잔액: ${ethers.formatEther(wethBalance)} WETH`);
    console.log(`필요한 금액: ${ethers.formatEther(offerPrice)} WETH`);
    
    if (wethBalance < offerPrice) {
      throw new Error(`WETH 잔액이 부족합니다. ${ethers.formatEther(offerPrice)} WETH가 필요하지만, ${ethers.formatEther(wethBalance)} WETH만 보유하고 있습니다.`);
    }
    
    // WETH 승인 확인
    const allowance = await wethContract.allowance(this.walletAddress, SEAPORT_ADDRESS);
    
    if (allowance < offerPrice) {
      console.log('WETH 승인 중...');
      const approveTx = await wethContract.approve(SEAPORT_ADDRESS, offerPrice);
      await approveTx.wait();
      console.log('WETH 승인 완료');
    } else {
      console.log('이미 충분한 WETH가 승인되었습니다');
    }
    
    return true;
  }
  
  /**
   * 컬렉션에 오퍼 제출
   */
  async createCollectionOffer(collectionSlug: string, offerPriceEth: string, expirationHours: number) {
    try {
      console.log(`${collectionSlug} 컬렉션에 오퍼 생성 중...`);
      
      // WETH로 가격 설정 (ETH -> WETH)
      const offerPriceWei = ethers.parseEther(offerPriceEth);
      
      // WETH 잔액 및 승인 확인
      await this.checkAndApproveWETH(offerPriceWei);
      
      // 만료 시간 설정 (현재 시간 + expirationHours)
      const expirationTime = Math.round(Date.now() / 1000 + expirationHours * 60 * 60);
      
      // 컬렉션 정보 가져오기
      console.log(`컬렉션 정보 가져오는 중: ${collectionSlug}`);
      const collection = await this.openseaSDK.api.getCollection(collectionSlug);
      console.log(`컬렉션 정보 가져옴: ${collection.collection}`);
      
      // 컬렉션 오퍼 생성
      const offer = await this.openseaSDK.createCollectionOffer({
        collectionSlug: collectionSlug,
        accountAddress: this.walletAddress,
        amount: offerPriceEth,
        expirationTime,
        paymentTokenAddress: WETH_CONTRACT_ADDRESS,
        quantity: 1
      });
      
      console.log('컬렉션 오퍼가 성공적으로 생성되었습니다!');
      console.log('오퍼 상세 정보:', offer);
      
      return offer;
    } catch (error: any) {
      console.error('컬렉션 오퍼 생성 중 오류 발생:', error.message || error);
      throw error;
    }
  }
}

/**
 * 메인 함수: 컬렉션 오퍼 제출 프로세스
 */
async function submitCollectionOffer() {
  const fordefiManager = new FordefiProviderManager();
  
  try {
    // 1. Fordefi Provider 연결
    const signer = await fordefiManager.connect();
    
    // 2. OpenSea 오퍼 매니저 초기화
    const offerManager = new OpenSeaOfferManager(signer, fordefiManager.walletAddress);
    
    // 3. 컬렉션 오퍼 생성
    await offerManager.createCollectionOffer(
      COLLECTION_SLUG,
      OFFER_PRICE,
      OFFER_DURATION_HOURS
    );
    
    console.log('컬렉션 오퍼 프로세스가 성공적으로 완료되었습니다!');
  } catch (error: any) {
    // 오류 처리
    if (error?.message?.includes('balances needed') || error?.message?.includes('잔액이 부족')) {
      console.error('잔액 또는 승인 오류:', error.message);
      console.log('다음을 확인해보세요:');
      console.log('1. WETH 잔액이 충분한지');
      console.log('2. WETH 승인이 되어있는지');
    } else if (error?.message?.includes('api.getCollection')) {
      console.error('컬렉션 슬러그 오류:', error.message);
      console.log('컬렉션 슬러그가 올바른지 확인하세요. OpenSea URL에서 확인할 수 있습니다.');
    } else {
      console.error('오류 발생:', error.message || error);
    }
  } finally {
    // 항상 Provider 연결 해제
    await fordefiManager.disconnect();
  }
}

// 컬렉션 오퍼 함수 실행
submitCollectionOffer();
